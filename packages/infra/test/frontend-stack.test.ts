import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { FrontendStack } from "../lib/frontend-stack.js";

function template() {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new FrontendStack(app, "TestFrontend", {});
  return Template.fromStack(stack);
}

describe("FrontendStack", () => {
  it("creates a CloudFront distribution", () => {
    template().resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  it("creates a site bucket", () => {
    template().resourceCountIs("AWS::S3::Bucket", 1);
  });
});
