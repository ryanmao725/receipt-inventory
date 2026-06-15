import { Stack, type StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  OpenIdConnectProvider,
  Role,
  WebIdentityPrincipal,
  PolicyStatement,
  Effect,
} from "aws-cdk-lib/aws-iam";

const GITHUB_DOMAIN = "token.actions.githubusercontent.com";
// The GitHub repo hosting the Actions workflows. Note this differs from the project/package
// name ("receipt-scanner") — the code is hosted in the "receipt-inventory" repository.
const GITHUB_REPO = "ryanmao725/receipt-inventory";

export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const provider = new OpenIdConnectProvider(this, "GithubOidcProvider", {
      url: `https://${GITHUB_DOMAIN}`,
      clientIds: ["sts.amazonaws.com"],
    });

    // Trust only this repo's master branch via OIDC web identity. Both conditions use
    // StringEquals: `aud` guards against token replay from other AWS services, and the exact
    // `sub` pins the branch (no wildcard — forks, other branches, and PRs cannot assume it).
    const principal = new WebIdentityPrincipal(provider.openIdConnectProviderArn, {
      StringEquals: {
        [`${GITHUB_DOMAIN}:aud`]: "sts.amazonaws.com",
        [`${GITHUB_DOMAIN}:sub`]: `repo:${GITHUB_REPO}:ref:refs/heads/master`,
      },
    });

    const role = new Role(this, "GithubActionsDeployRole", {
      roleName: "receipt-scanner-github-actions-deploy",
      assumedBy: principal,
      description: "Assumed by GitHub Actions via OIDC to deploy receipt-scanner",
      // GitHub Actions deploy jobs are short; the 1-hour default is intentional.
      maxSessionDuration: Duration.hours(1),
    });

    // cdk deploy assumes the CDK v2 bootstrap roles.
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    // Frontend workflow reads this project's stack outputs.
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["cloudformation:DescribeStacks"],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/receipt-scanner-*/*`,
        ],
      }),
    );
    // Frontend workflow syncs the site bucket.
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        // TODO: scope to the site bucket ARN once the bucket name is stable.
        actions: ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: ["*"],
      }),
    );
    // Frontend workflow invalidates CloudFront after each deploy.
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["cloudfront:CreateInvalidation"],
        resources: ["*"],
      }),
    );

    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
