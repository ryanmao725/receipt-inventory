# Receipt Scanner — Design Spec

**Date:** 2026-06-14
**Status:** Approved (scaffold scope)

## Overview

A receipt-scanning application that lets a user scan a receipt image, automatically
extracts purchased line items, manages those items as inventory, and suggests recipes
based on the current inventory. Deployable to AWS via a CDK package, with separate
frontend and backend packages in a pnpm monorepo.

This spec covers a **deployable scaffold**: the full structure, infrastructure, and
wiring are real and deploy/synth cleanly, while receipt-parsing and recipe business
logic are minimally stubbed with clear `// TODO` markers for later implementation.

## Tech Stack

- **Monorepo:** pnpm workspaces, all TypeScript
- **Frontend:** React + Vite SPA, hosted on S3 + CloudFront
- **Backend:** Node.js Lambda functions behind an API Gateway HTTP API
- **Infra:** AWS CDK (TypeScript), one deployable stack
- **Auth:** Amazon Cognito (email/password), JWT authorizer on the HTTP API
- **OCR:** AWS Textract `AnalyzeExpense` (synchronous, single-page receipts)
- **Data:** DynamoDB (multi-table); receipt images in S3
- **Recipes:** Spoonacular API (key stored in SSM Parameter Store)

## Monorepo Layout

```
receipt-scanner/
├─ pnpm-workspace.yaml
├─ package.json            # root: workspace scripts
├─ tsconfig.base.json
└─ packages/
   ├─ shared/              # TS types shared by frontend + backend
   ├─ frontend/            # React + Vite SPA (Scan / Inventory / Recipes)
   ├─ backend/             # Lambda handlers + domain logic
   └─ infra/               # CDK app (single stack) wiring everything
```

### Package responsibilities

- **shared** — Type definitions only: `Receipt`, `ReceiptLineItem`, `InventoryItem`,
  `Recipe`, and API request/response shapes. No runtime dependencies. Consumed by both
  frontend and backend so the API contract stays in sync.
- **frontend** — React + Vite SPA. Three pages: Scan (upload a receipt image),
  Inventory (list/edit/delete items), Recipes (suggestions from inventory). Uses
  `aws-amplify` + `@aws-amplify/ui-react` `<Authenticator>` for in-app email/password
  login and attaches the Cognito JWT to API calls.
- **backend** — Lambda handler(s) for the API routes, plus domain modules for Textract
  parsing, DynamoDB access, and the Spoonacular client. Reads the authenticated user
  `sub` from the JWT authorizer claims.
- **infra** — CDK app defining one stack with all AWS resources below.

## Auth

- **Cognito User Pool + User Pool Client**: email/password sign-up & sign-in with email
  verification. No social login in the scaffold (the Cognito construct is structured so
  a Google identity provider + Cognito domain can be added later as a localized change).
- **API Gateway HTTP API JWT authorizer** bound to the User Pool. Every route requires a
  valid Cognito access token.
- The backend trusts the user `sub` only from the JWT authorizer claims, never from the
  client request body.
- Amplify config (User Pool ID, Client ID, region) is surfaced to the frontend build.

## Data Flow

1. User signs in (Cognito) and uploads a receipt image in the SPA → `POST /receipts`.
2. Backend stores the image in the S3 receipts bucket, calls Textract `AnalyzeExpense`,
   and parses the response into structured line items.
3. The receipt record is written to the **Receipts** table; extracted items are merged
   into the **InventoryItems** table.
4. `GET /inventory` lists the user's current stock; items can be edited or deleted.
5. `GET /recipes` queries Spoonacular using the user's inventory ingredients and returns
   recipe suggestions.

## API (backend)

All routes require a valid Cognito JWT.

| Method | Path               | Purpose                                            |
|--------|--------------------|----------------------------------------------------|
| POST   | `/receipts`        | Upload + scan a receipt, populate inventory        |
| GET    | `/inventory`       | List the user's inventory items                    |
| PATCH  | `/inventory/{id}`  | Update an inventory item (e.g. quantity)           |
| DELETE | `/inventory/{id}`  | Remove an inventory item                           |
| GET    | `/recipes`         | Recipe suggestions from current inventory          |

## Data Model (DynamoDB, multi-table)

Two tables, both scoped per user.

**Receipts**
- Partition key: `userId` (Cognito `sub`)
- Sort key: `receiptId`
- Attributes: `merchant`, `purchasedAt`, `total`, `imageS3Key`, `lineItems[]`, `createdAt`

**InventoryItems**
- Partition key: `userId` (Cognito `sub`)
- Sort key: `itemId`
- Attributes: `name`, `quantity`, `unit`, `sourceReceiptId`, `updatedAt`

"List everything for a user" is a single `Query` on the partition key in each table.

## AWS Resources (CDK, single stack)

- S3 bucket for receipt images
- S3 bucket + CloudFront distribution for frontend hosting
- DynamoDB `Receipts` table
- DynamoDB `InventoryItems` table
- Cognito User Pool + User Pool Client
- API Gateway HTTP API + JWT authorizer (bound to the User Pool)
- Lambda function(s) for the API routes
- SSM Parameter Store entry for the Spoonacular API key
- IAM roles granting Lambda least-privilege access to Textract, DynamoDB, S3, and SSM

## Scope of This Scaffold

**In scope (real and working):**
- All four packages compile; `pnpm -r build` succeeds.
- `cdk synth` produces a valid CloudFormation template.
- Lambda handlers exist with real routing, auth claim extraction, and DynamoDB wiring.
- Frontend renders the three pages, authenticates via Cognito, and calls the API.

**Stubbed with `// TODO` markers:**
- Textract `AnalyzeExpense` response parsing into line items (minimal mapping).
- Spoonacular API calls (client structure in place, minimal request/response handling).
- Frontend UI is placeholder-level — functional, not visually polished.

## Deliberately Deferred (YAGNI)

- Social / Google login (email/password only for now)
- Async/SQS processing pipeline (synchronous Textract is sufficient for single receipts)
- CI/CD pipeline and multi-environment configuration
- Production-grade frontend visual design
