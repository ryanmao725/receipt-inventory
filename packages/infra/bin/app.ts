import { App } from "aws-cdk-lib";
import { BackendStack } from "../lib/backend-stack.js";
import { FrontendStack } from "../lib/frontend-stack.js";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new BackendStack(app, "BackendStack", { stackName: "receipt-scanner-backend", env });
new FrontendStack(app, "FrontendStack", { stackName: "receipt-scanner-frontend", env });
new GithubOidcStack(app, "GithubOidcStack", { stackName: "receipt-scanner-github-oidc", env });
