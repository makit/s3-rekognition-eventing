import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as actions from 'aws-cdk-lib/aws-ses-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdanode from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ProcessFileConstructProps {
  emailRecipient: string;
  bucket: s3.IBucket;
  attachmentPrefix: string;
}

export default class EmailToS3Construct extends Construct {

  constructor(scope: Construct, id: string, props: ProcessFileConstructProps) {
    super(scope, id);

    const objectKeyPrefix = 'emails/';
    const objectArchivedPrefix = 'archived/';

    new ses.ReceiptRuleSet(this, 'EmailToS3RuleSet', {
      rules: [
        {
          recipients: [props.emailRecipient],
          actions: [
            new actions.S3({
              bucket: props.bucket,
              objectKeyPrefix,
            }),
          ],
        },
      ],
    });

    // Lambda will extract attachments (if any) and put them under a specific prefix, and then 
    // move the email to an archive folder.
    const lambdaProcessor = new lambdanode.NodejsFunction(this, 'lambda', {
      runtime: lambda.Runtime.NODEJS_16_X,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        ArchivePrefix: objectArchivedPrefix,
        AttachmentPrefix: props.attachmentPrefix,
        TriggerPrefix: objectKeyPrefix,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
      timeout: Duration.seconds(30),
    });

    lambdaProcessor.addToRolePolicy(new iam.PolicyStatement({
      resources: [`${props.bucket.bucketArn}/*`],
      actions: ['s3:GetObject', 's3:CopyObject', 's3:PutObject', 's3:DeleteObject'],
    }));

    props.bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(lambdaProcessor), {
      prefix: objectKeyPrefix,
    });
  }
}