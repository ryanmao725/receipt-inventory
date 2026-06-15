# Receipt Scanner

pnpm monorepo: scan receipts (Textract) → inventory (DynamoDB) → recipe suggestions (Spoonacular). React + Vite SPA, Node Lambda behind an API Gateway HTTP API with Cognito auth, deployed via AWS CDK.

## Packages
- `packages/shared` — shared TypeScript types
- `packages/backend` — Lambda handlers + domain logic
- `packages/frontend` — React + Vite SPA
- `packages/infra` — AWS CDK app (single stack)

## Develop
```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Deploy
```bash
# 1. Set the Spoonacular key (do not commit it)
aws ssm put-parameter --name /receipt-scanner/spoonacular-api-key --type String --value YOUR_KEY --overwrite

# 2. Deploy infra (outputs ApiUrl, UserPoolId, UserPoolClientId, Region, SiteBucketName)
pnpm --filter infra deploy

# 3. Configure the frontend from the stack outputs
cp packages/frontend/.env.example packages/frontend/.env   # fill in the output values

# 4. Build the frontend and upload to the site bucket
pnpm --filter @receipt-scanner/frontend build
aws s3 sync packages/frontend/dist s3://<SiteBucketName> --delete
```

## Scaffold status
Textract parsing, the `POST /receipts` flow, and Spoonacular calls are wired but minimally stubbed (see `// TODO` markers). Auth is email/password only.
