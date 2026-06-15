import { Stack, type StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ReceiptScannerStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // --- Storage ---
    const receiptsBucket = new s3.Bucket(this, "ReceiptsBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const receiptsTable = new dynamodb.Table(this, "ReceiptsTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "receiptId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const inventoryTable = new dynamodb.Table(this, "InventoryTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "itemId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Auth ---
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 8, requireDigits: true, requireLowercase: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true },
    });

    // --- Config ---
    const spoonacularParam = new StringParameter(this, "SpoonacularKey", {
      parameterName: "/receipt-scanner/spoonacular-api-key",
      stringValue: "REPLACE_ME", // TODO: set the real key out-of-band; do not commit secrets.
    });

    // --- Compute ---
    const apiFn = new NodejsFunction(this, "ApiFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, "../../backend/src/handler.ts"),
      handler: "handler",
      environment: {
        RECEIPTS_TABLE: receiptsTable.tableName,
        INVENTORY_TABLE: inventoryTable.tableName,
        RECEIPTS_BUCKET: receiptsBucket.bucketName,
        SPOONACULAR_API_KEY: spoonacularParam.stringValue,
      },
      bundling: { format: undefined },
    });

    receiptsTable.grantReadWriteData(apiFn);
    inventoryTable.grantReadWriteData(apiFn);
    receiptsBucket.grantReadWrite(apiFn);
    apiFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["textract:AnalyzeExpense"],
        resources: ["*"],
      }),
    );

    // --- API ---
    const authorizer = new HttpJwtAuthorizer("JwtAuthorizer", userPool.userPoolProviderUrl, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    const httpApi = new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);
    for (const route of [
      { path: "/receipts", methods: [HttpMethod.POST] },
      { path: "/inventory", methods: [HttpMethod.GET] },
      { path: "/inventory/{id}", methods: [HttpMethod.PATCH, HttpMethod.DELETE] },
      { path: "/recipes", methods: [HttpMethod.GET] },
    ]) {
      httpApi.addRoutes({ path: route.path, methods: route.methods, integration, authorizer });
    }

    // --- Frontend hosting ---
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // --- Outputs (consumed by frontend build) ---
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "Region", { value: this.region });
    new CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
    new CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
