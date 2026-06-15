import { App } from "aws-cdk-lib";
import { ReceiptScannerStack } from "../lib/receipt-scanner-stack.js";

const app = new App();
new ReceiptScannerStack(app, "ReceiptScannerStack", {});
