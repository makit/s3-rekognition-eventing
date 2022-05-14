import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import ProcessFileConstruct from '../constructs/process-file/process-file-construct';
import EmailToS3Construct from '../constructs/email-to-s3/email-to-s3-construct';

export interface RekogEventingStackProps extends StackProps {
  expireObjectsAfterXDays: number;
  algorithmMinConfidence: number;
  algorithmMaxLabels: number;
  emailRecipient?: string;
}

export class RekogEventingStack extends Stack {
  constructor(scope: Construct, id: string, props: RekogEventingStackProps) {
    super(scope, id, props);

    const detailType = 'rekognition-analysed-image';
    const attachmentPrefix = 'analyse/';
    
    const processQueue = new sqs.Queue(this, 'ProcessQueue');

    // The input bucket with the eventing out to SQS for each new object 
    const filesToProcessBucket = new s3.Bucket(this, 'FilesToProcessBucket', {
      lifecycleRules: [{ expiration: Duration.days(props.expireObjectsAfterXDays) }],
    });
    filesToProcessBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(processQueue), {
      prefix: attachmentPrefix,
    });

    if (props.emailRecipient) {
      new EmailToS3Construct(this, 'EmailToS3', {
        bucket: filesToProcessBucket,
        emailRecipient: props.emailRecipient,
        attachmentPrefix,
      });
    }

    // Results from the analysis will be sent to this Bus
    const eventBus = new events.EventBus(this, 'Bus');

    const processFileConstruct = new ProcessFileConstruct(this, 'ProcessFile', {
      algorithmMaxLabels: props.algorithmMaxLabels,
      algorithmMinConfidence: props.algorithmMinConfidence,
      bucket: filesToProcessBucket,
      eventBus: eventBus,
      detailType: detailType,      
    });

    // Invoked by SQS
    processFileConstruct.lambda.addEventSource(new eventsources.SqsEventSource(processQueue));
    processFileConstruct.lambda.addPermission('SQSInvoke', {
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
  }
}
