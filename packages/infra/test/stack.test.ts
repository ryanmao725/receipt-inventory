import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ReceiptScannerStack } from "../lib/receipt-scanner-stack.js";

function template() {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new ReceiptScannerStack(app, "TestStack", {});
  return Template.fromStack(stack);
}

describe("ReceiptScannerStack", () => {
  it("creates two DynamoDB tables", () => {
    template().resourceCountIs("AWS::DynamoDB::Table", 2);
  });

  it("creates a Cognito user pool", () => {
    template().resourceCountIs("AWS::Cognito::UserPool", 1);
  });

  it("creates an HTTP API", () => {
    template().resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  });
});
