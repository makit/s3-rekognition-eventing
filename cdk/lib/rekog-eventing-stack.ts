import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface RekogEventingStackProps extends StackProps {
  expireObjectsAfterXDays: number;
  algorithmMinConfidence: number;
  algorithmMaxLabels: number;
}

export class RekogEventingStack extends Stack {
  constructor(scope: Construct, id: string, props: RekogEventingStackProps) {
    super(scope, id, props);

    const detailType = 'rekognition-analysed-image';
    
    const processQueue = new sqs.Queue(this, 'ProcessQueue');

    // The input bucket with the eventing out to SQS for each new object 
    const filesToProcessBucket = new s3.Bucket(this, 'FilesToProcessBucket', {
      lifecycleRules: [{ expiration: Duration.days(props.expireObjectsAfterXDays) }],
    });
    filesToProcessBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(processQueue));

    // Results from the analysis will be sent to this Bus
    const eventBus = new events.EventBus(this, 'Bus');

    const processFileFunction = this.createProcessLambda(props, eventBus, detailType, filesToProcessBucket.bucketArn);

    // Invoked by SQS
    processFileFunction.addEventSource(new eventsources.SqsEventSource(processQueue));
    processFileFunction.addPermission('SQSInvoke', {
      principal: new iam.ServicePrincipal('sqs.amazonaws.com'),
    });

    // Result SNS topics
    const highPriorityTopic = new sns.Topic(this, 'HighPriorityTopic', { topicName: 'REKOGNITION_HIGH_PRIORITY' });
    const mediumPriorityTopic = new sns.Topic(this, 'MediumPriorityTopic', { topicName: 'REKOGNITION_MED_PRIORITY' });
    const lowPriorityTopic = new sns.Topic(this, 'LowPriorityTopic', { topicName: 'REKOGNITION_LOW_PRIORITY' });

    const highPriorityRule = new events.Rule(this, 'HighPriorityRule', {
      eventPattern: {
        detailType: [detailType],
        detail: {
          labels: ['Person', 'Human'],
        }
      },
      eventBus,
    });
    highPriorityRule.addTarget(new targets.SnsTopic(highPriorityTopic));

    const mediumPriorityRule = new events.Rule(this, 'MediumPriorityRule', {
      eventPattern: {
        detailType: [detailType],
        detail: {
          labels: ['Dog'],
        }
      },
      eventBus,
    });
    mediumPriorityRule.addTarget(new targets.SnsTopic(mediumPriorityTopic));

    const lowPriorityRule = new events.Rule(this, 'LowPriorityRule', {
      eventPattern: {
        detailType: [detailType]
      },
      eventBus,
    });
    lowPriorityRule.addTarget(new targets.SnsTopic(lowPriorityTopic));

    // Example: You could have a rule that hits a lambda to delete the image immediately
  }

  private createProcessLambda(props: RekogEventingStackProps, eventBus: events.EventBus, detailType: string, bucketArn: string) {

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
      resources: [eventBus.eventBusArn],
      actions: ['events:PutEvents'],
    }));
    processFileLambdaRole.addToPolicy(new iam.PolicyStatement({
      resources: [`${bucketArn}/*`],
      actions: ['s3:GetObject'],
    }));

    // The lambda that processes the Rekognition calls and fires events
    return new lambda.Function(this, 'ProcessFileFunction', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'process-file.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/built/')),
      environment: {
        MinConfidence: props.algorithmMinConfidence.toString(),
        MaxLabels: props.algorithmMaxLabels.toString(),
        EventBusName: eventBus.eventBusName,
        DetailType: detailType,
      },
      timeout: Duration.seconds(30),
      role: processFileLambdaRole,
    });
  }
}
