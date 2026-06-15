# Receipt Scanner

pnpm monorepo: scan receipts (Textract) → inventory (DynamoDB) → recipe suggestions (Spoonacular). React + Vite SPA, Node Lambda behind an API Gateway HTTP API with Cognito auth, deployed via AWS CDK.

## Packages
- `packages/shared` — shared TypeScript types
- `packages/backend` — Lambda handlers + domain logic
- `packages/frontend` — React + Vite SPA
- `packages/infra` — AWS CDK app (backend, frontend, and GitHub OIDC stacks)

## Develop
```bash
pnpm install
pnpm -r build
pnpm -r test
```

## One-time setup (CI/CD via OIDC)

Deploys run from GitHub Actions using OIDC (no long-lived AWS keys). Bootstrap once with admin credentials:

```bash
# 1. Bootstrap CDK in the target account/region
pnpm --filter infra exec cdk bootstrap aws://<account>/<region>

# 2. Deploy the OIDC provider + deploy role (one time, admin creds)
pnpm --filter infra exec cdk deploy receipt-scanner-github-oidc --require-approval never
# note the DeployRoleArn output

# 3. Set the Spoonacular key (do not commit it)
aws ssm put-parameter --name /receipt-scanner/spoonacular-api-key --type String --value YOUR_KEY --overwrite
```

Then add GitHub repository **Variables** (Settings → Secrets and variables → Actions → Variables):
- `AWS_REGION` — e.g. `us-east-1`
- `AWS_DEPLOY_ROLE_ARN` — the `DeployRoleArn` from step 2

## Deploy

Pushes to `master` deploy automatically:
- Changes under `packages/backend`, `packages/shared`, or `packages/infra` → **deploy-backend** (`cdk deploy receipt-scanner-backend`).
- Changes under `packages/frontend`, `packages/shared`, or `packages/infra` → **deploy-frontend** (`cdk deploy receipt-scanner-frontend`, then reads backend outputs into `.env`, builds, syncs to S3, invalidates CloudFront).

Pull requests run **CI** (build, test, synth) only.

Manual deploy (admin creds) is still possible:

```bash
pnpm --filter infra exec cdk deploy receipt-scanner-backend receipt-scanner-frontend --require-approval never
```

## Scaffold status
Textract parsing, the `POST /receipts` flow, and Spoonacular calls are wired but minimally stubbed (see `// TODO` markers). Auth is email/password only.
