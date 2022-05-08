import * as aws from 'aws-sdk';

export interface S3EventNotificationS3RecordBucket {
  name: string;
  arn: string;
}

export interface S3EventNotificationS3RecordObject {
  key: string;
}

export interface S3EventNotificationS3Record {
  bucket: S3EventNotificationS3RecordBucket;
  object: S3EventNotificationS3RecordObject;
}

export interface S3EventNotificationRecord {
  s3: S3EventNotificationS3Record;
}

export interface S3EventNotification {
  Records: S3EventNotificationRecord[];
}

export interface ProcessFileRecord {
  messageId: string;
  body: string;
}

export interface ProcessFileEvent {
  Records: ProcessFileRecord[];
}

export interface ProcessFileResponseFailure {
  itemIdentifier: string;
}

export interface ProcessFileResponse {
  batchItemFailures: ProcessFileResponseFailure[];
}

export interface FileResult {
  labels: string[];
}

class ProcessFile {
  private readonly _eventBusName: string;
  private readonly _detailType: string;
  private readonly _minConfidence: number;
  private readonly _maxLabels: number;
  private readonly _rekognition: aws.Rekognition;
  private readonly _eventBridge: aws.EventBridge;

  constructor() {
    const { MinConfidence, MaxLabels, EventBusName, DetailType } = process.env;

    this._minConfidence = Number(MinConfidence);
    this._maxLabels = Number(MaxLabels);
    this._eventBusName = EventBusName;
    this._detailType = DetailType;
    this._rekognition = new aws.Rekognition();
    this._eventBridge = new aws.EventBridge({});

    console.info('Initialised');
  }

  processSingleFile = async (record: S3EventNotificationS3Record): Promise<FileResult> => {
    console.info('Processing Record', JSON.stringify(record, null, 2));

    const params : aws.Rekognition.DetectLabelsRequest = {
      Image: {
          S3Object: {
            Bucket: record.bucket.name,
            Name: record.object.key,
          },
        },
      MinConfidence: this._minConfidence,
      MaxLabels: this._maxLabels,
    };

    const rekResults = await this._rekognition.detectLabels(params).promise();
    console.log('Rekognition Response:', JSON.stringify(rekResults, null, 2));

    if(rekResults.Labels.length > 0) {

      return {
        labels: rekResults.Labels.map((label) => label.Name),
      };

    } else {

      console.log('No labels returned for image');

      return {
        labels: [],
      };
    }
  }

  handler = async (event: ProcessFileEvent): Promise<ProcessFileResponse> => {
    console.info('Received Event:', JSON.stringify(event));

    const response : ProcessFileResponse = {
      batchItemFailures: [],
    };

    const eventsToSend : aws.EventBridge.PutEventsRequestEntry[] = [];

    const analysisJobs = event.Records.map((record) => {
      const recordBody : S3EventNotification = JSON.parse(record.body);

      // Read only the first record, as the PutObject will only have one record
      const s3Details = recordBody.Records[0].s3;

      return this.processSingleFile(s3Details)
        .then((processResult) => {

          if (processResult.labels.length > 0) {
            const event : aws.EventBridge.PutEventsRequestEntry = {
              EventBusName: this._eventBusName,
              DetailType: this._detailType,
              Detail: JSON.stringify(processResult),
              Source: 'rekognition-processor',
            };
            eventsToSend.push(event);
            console.info('Pushing Event', JSON.stringify(event, null, 2));
          }
          
        })
        .catch((error) => {
          console.error('Record Failed', record, error);

          // Send any failures back so SQS will try them again
          response.batchItemFailures.push({ itemIdentifier: record.messageId });
          return error;
        })
    });

    await Promise.allSettled(analysisJobs);

    if (eventsToSend.length > 0) {
      // Send all events to Event Bridge. If this fails then the lambda fails and it will be hit again
      const pushResult = await this._eventBridge.putEvents({ Entries: eventsToSend }).promise();
      console.debug('Event Push Result', JSON.stringify(pushResult, null, 2));
    }
    
    return response;
  };
}

const processFile = new ProcessFile();
export const handler = async (event: ProcessFileEvent): Promise<ProcessFileResponse> => processFile.handler(event);