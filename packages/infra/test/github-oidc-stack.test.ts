import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";

function template() {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new GithubOidcStack(app, "TestOidc", {});
  return Template.fromStack(stack);
}

describe("GithubOidcStack", () => {
  it("creates a GitHub OIDC provider", () => {
    template().resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 1);
  });

  it("creates the named deploy role", () => {
    template().hasResourceProperties("AWS::IAM::Role", {
      RoleName: "receipt-scanner-github-actions-deploy",
    });
  });

  it("pins the trust policy to the repo master branch", () => {
    template().hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:ryanmao725/receipt-inventory:ref:refs/heads/master",
              },
            },
          }),
        ]),
      },
    });
  });
});
