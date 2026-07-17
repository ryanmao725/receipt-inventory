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
  it("creates three DynamoDB tables", () => {
    template().resourceCountIs("AWS::DynamoDB::Table", 3); // receipts, inventory, normalization cache
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

  it("grants the API function Bedrock InvokeModel for normalization", () => {
    template().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "bedrock:InvokeModel" }),
        ]),
      },
    });
  });

  it("exposes the propose and commit routes", () => {
    template().hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /receipts/propose" });
    template().hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /receipts/commit" });
  });

  it("exposes the consume routes", () => {
    template().hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /inventory/{id}/consume" });
    template().hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /inventory/consume" });
  });
});
