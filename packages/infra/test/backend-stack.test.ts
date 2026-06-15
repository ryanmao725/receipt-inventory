import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BackendStack } from "../lib/backend-stack.js";

function template() {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new BackendStack(app, "TestBackend", {});
  return Template.fromStack(stack);
}

describe("BackendStack", () => {
  it("creates two DynamoDB tables", () => {
    template().resourceCountIs("AWS::DynamoDB::Table", 2);
  });

  it("creates a Cognito user pool", () => {
    template().resourceCountIs("AWS::Cognito::UserPool", 1);
  });

  it("creates an HTTP API", () => {
    template().resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  });

  it("does not create a CloudFront distribution", () => {
    template().resourceCountIs("AWS::CloudFront::Distribution", 0);
  });

  it("exposes the presigned-upload route", () => {
    template().hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /receipts/upload-url",
    });
  });

  it("allows browser PUT uploads to the receipts bucket via CORS", () => {
    template().hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({ AllowedMethods: Match.arrayWith(["PUT"]) }),
        ]),
      },
    });
  });
});
