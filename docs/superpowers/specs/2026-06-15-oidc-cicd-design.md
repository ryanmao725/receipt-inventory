# OIDC CI/CD Design

**Date:** 2026-06-15
**Repo:** `github.com/ryanmao725/receipt-inventory`

## Goal

Deploy the receipt-scanner monorepo to AWS automatically from GitHub Actions, using OpenID Connect (OIDC) for short-lived credentials (no long-lived AWS access keys stored in GitHub). Frontend and backend deploy independently via separate stacks and separate workflows.

## Decisions

- **OIDC bootstrap:** a dedicated CDK stack (`GithubOidcStack`) creates the GitHub OIDC provider and deploy role; deployed once manually with admin credentials.
- **Stack split:** the existing single `ReceiptScannerStack` is split into a `BackendStack` and a `FrontendStack`, each with its own deploy workflow.
- **Frontend↔backend config:** the frontend workflow reads the backend stack's CloudFormation outputs at deploy time (`aws cloudformation describe-stacks`) to produce `.env` before building — no CDK cross-stack references.
- **Deploy role:** one shared `GithubActionsDeployRole` for both workflows (can be split into per-workflow least-privilege roles later).

## Architecture

### CDK stacks (3)

`bin/app.ts` instantiates all three. Each has an explicit deterministic `stackName` so workflows can target it.

**`GithubOidcStack`** (stackName `receipt-scanner-github-oidc`) — deployed once, manually.
- GitHub OIDC identity provider (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`).
- `GithubActionsDeployRole` with a trust policy (web identity) scoped to
  `repo:ryanmao725/receipt-inventory:ref:refs/heads/master`.
- Role permissions:
  - `sts:AssumeRole` on `arn:aws:iam::<account>:role/cdk-*` (so `cdk deploy` can assume the CDK v2 bootstrap roles).
  - `cloudformation:DescribeStacks` (frontend workflow reads backend outputs).
  - `s3:*` scoped to the site bucket + its objects (frontend sync).
  - `cloudfront:CreateInvalidation`.
- Output: `DeployRoleArn` (set as a GitHub repo variable).

**`BackendStack`** (stackName `receipt-scanner-backend`)
- DynamoDB ReceiptsTable + InventoryTable, Cognito User Pool + web client, SSM Spoonacular key (placeholder), receipts S3 bucket, `NodejsFunction` Lambda + IAM grants + `textract:AnalyzeExpense`, HTTP API + JWT authorizer + routes.
- Outputs (CfnOutput with stable export names): `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `Region`.

**`FrontendStack`** (stackName `receipt-scanner-frontend`)
- Site S3 bucket (private, OAC) + CloudFront distribution with SPA error-routing.
- Outputs: `SiteBucketName`, `DistributionId`, `SiteUrl`.

Stack unit tests split accordingly: backend test asserts 2 DynamoDB tables, 1 Cognito user pool, 1 HTTP API; frontend test asserts 1 CloudFront distribution; oidc test asserts 1 OIDC provider + 1 IAM role.

### Workflows (`.github/workflows/`)

All deploy workflows declare `permissions: { id-token: write, contents: read }` and authenticate with `aws-actions/configure-aws-credentials@v4` using `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}` and `aws-region: ${{ vars.AWS_REGION }}`. Node 20 + pnpm via `pnpm/action-setup`.

**`ci.yml`** — trigger `pull_request`.
Steps: checkout → setup node/pnpm → `pnpm install` → `pnpm -r build` → `pnpm -r test` → `pnpm --filter infra synth`. No AWS credentials (synth needs none).

**`deploy-backend.yml`** — trigger `push` to `master` with `paths: [packages/backend/**, packages/shared/**, packages/infra/**, .github/workflows/deploy-backend.yml]`.
Steps: checkout → node/pnpm → install → build shared + backend → OIDC assume role → `pnpm --filter infra exec cdk deploy receipt-scanner-backend --require-approval never`.

**`deploy-frontend.yml`** — trigger `push` to `master` with `paths: [packages/frontend/**, packages/shared/**, packages/infra/**, .github/workflows/deploy-frontend.yml]`.
Steps: checkout → node/pnpm → install → build shared → OIDC assume role →
1. `cdk deploy receipt-scanner-frontend --require-approval never`
2. `describe-stacks` on `receipt-scanner-backend` → write `ApiUrl`/`UserPoolId`/`UserPoolClientId`/`Region` into `packages/frontend/.env` (as `VITE_*`)
3. `describe-stacks` on `receipt-scanner-frontend` → capture `SiteBucketName`, `DistributionId`
4. `pnpm --filter @receipt-scanner/frontend build`
5. `aws s3 sync packages/frontend/dist s3://$SiteBucketName --delete`
6. `aws cloudfront create-invalidation --distribution-id $DistributionId --paths "/*"`

## One-time setup (README)

1. `cdk bootstrap aws://<account>/<region>`
2. `pnpm --filter infra exec cdk deploy receipt-scanner-github-oidc` (admin creds)
3. GitHub repo variables: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN` (= `DeployRoleArn` output)
4. Set the Spoonacular SSM key out-of-band (existing step)
5. Push to `master` → workflows deploy

## Out of scope (YAGNI)

- PR preview environments / per-PR ephemeral stacks.
- Per-workflow least-privilege roles (single shared role for now).
- Multi-region / multi-account deploys.
- Manual `workflow_dispatch` triggers (can add later if needed).

## Security notes

- No long-lived AWS keys in GitHub; OIDC issues short-lived credentials per run.
- Trust policy is scoped to the specific repo and the `master` branch ref, so only pushes to `master` (not forks or other branches) can assume the deploy role.
- The Spoonacular key is never committed; only the `REPLACE_ME` SSM placeholder is in code.
