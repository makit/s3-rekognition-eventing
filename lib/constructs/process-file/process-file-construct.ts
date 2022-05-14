import { Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdanode from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ProcessFileConstructProps {
  algorithmMinConfidence: number;
  algorithmMaxLabels: number;
  eventBus: events.IEventBus;
  bucket: s3.IBucket;
  detailType: string;
}

export default class ProcessFileConstruct extends Construct {

  public readonly lambda : lambda.IFunction;

  constructor(scope: Construct, id: string, props: ProcessFileConstructProps) {
    super(scope, id);

    // Create the role (that allows hitting rekognition and event bridge) for the lambda
    const processFileLambdaRole = new iam.Role(this, 'ProcessFileRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    processFileLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    processFileLambdaRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['rekognition:DetectLabels'],
    }));
    processFileLambdaRole.addToPolicy(new iam.PolicyStatement({
      resources: [props.eventBus.eventBusArn],
      actions: ['events:PutEvents'],
    }));
    processFileLambdaRole.addToPolicy(new iam.PolicyStatement({
      resources: [`${props.bucket.bucketArn}/*`],
      actions: ['s3:GetObject'],
    }));

    // The lambda that processes the Rekognition calls and fires events
    this.lambda = new lambdanode.NodejsFunction(this, 'lambda', {
      runtime: lambda.Runtime.NODEJS_16_X,
      environment: {
        MinConfidence: props.algorithmMinConfidence.toString(),
        MaxLabels: props.algorithmMaxLabels.toString(),
        EventBusName: props.eventBus.eventBusName,
        DetailType: props.detailType,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
      timeout: Duration.seconds(30),
      role: processFileLambdaRole,
    });
  }
}