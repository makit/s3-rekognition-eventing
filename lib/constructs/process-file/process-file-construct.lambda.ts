import * as aws from 'aws-sdk';
import { SQSEvent, S3Event, S3EventRecord, SQSBatchResponse } from 'aws-lambda';

export interface FileResult {
  objectKey: string;
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

    if (!MinConfidence || !MaxLabels || !EventBusName || !DetailType) {
      throw new Error('Missing environment variables');
    }

    this._minConfidence = Number(MinConfidence);
    this._maxLabels = Number(MaxLabels);
    this._eventBusName = EventBusName;
    this._detailType = DetailType;
    this._rekognition = new aws.Rekognition();
    this._eventBridge = new aws.EventBridge({});

    console.info('Initialised');
  }

  processSingleFile = async (record: S3EventRecord): Promise<FileResult> => {
    console.info('Processing Record', JSON.stringify(record, null, 2));

    const params : aws.Rekognition.DetectLabelsRequest = {
      Image: {
          S3Object: {
            Bucket: record.s3.bucket.name,
            Name: record.s3.object.key,
          },
        },
      MinConfidence: this._minConfidence,
      MaxLabels: this._maxLabels,
    };

    const rekResults = await this._rekognition.detectLabels(params).promise();
    console.log('Rekognition Response:', JSON.stringify(rekResults, null, 2));

    if(rekResults && rekResults.Labels && rekResults.Labels.length > 0) {

      return {
        objectKey: record.s3.object.key,
        labels: rekResults.Labels
          .filter((label) => label && label.Name)
          .map((label) => label.Name || 'Unknown'),
      };

    } else {

      console.log('No labels returned for image');

      return {
        objectKey: record.s3.object.key,
        labels: [],
      };
    }
  }

  handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
    console.info('Received Event:', JSON.stringify(event));

    const response : SQSBatchResponse = {
      batchItemFailures: [],
    };

    const eventsToSend : aws.EventBridge.PutEventsRequestEntry[] = [];

    const analysisJobs = event.Records.map((record) => {
      const recordBody : S3Event = JSON.parse(record.body);

      // Handle S3 test events for example
      if (!recordBody || !recordBody.Records || recordBody.Records.length === 0) {
        return Promise.resolve();
      }

      // Read only the first record, as the PutObject will only have one record
      return this.processSingleFile(recordBody.Records[0])
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

// Initialise class outside of the handler so context is reused.
const processFile = new ProcessFile();

// The handler simply executes the object handler
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => processFile.handler(event);