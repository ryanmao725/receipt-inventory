import { App } from "aws-cdk-lib";
import { BackendStack } from "../lib/backend-stack.js";
import { FrontendStack } from "../lib/frontend-stack.js";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Construct IDs match the CloudFormation stack names so `cdk deploy receipt-scanner-*`
// (used by the workflows, README, and CLI) selects the right stack. The CDK stack
// selector matches the construct ID, not the stackName property.
new BackendStack(app, "receipt-scanner-backend", { env });
new FrontendStack(app, "receipt-scanner-frontend", { env });
new GithubOidcStack(app, "receipt-scanner-github-oidc", { env });
