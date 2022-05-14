import * as aws from 'aws-sdk';
import { S3Event } from 'aws-lambda';
import { GetObjectRequest } from 'aws-sdk/clients/s3';

const simpleParser = require('mailparser').simpleParser;

class ProcessEmail {
  private readonly _triggerPrefix: string;
  private readonly _archivePrefix: string;
  private readonly _attachmentPrefix: string;
  private readonly _s3: aws.S3;

  constructor() {
    const { TriggerPrefix, ArchivePrefix, AttachmentPrefix } = process.env;

    if (!TriggerPrefix ||!ArchivePrefix || !AttachmentPrefix) {
      throw new Error('Missing environment variables');
    }

    this._triggerPrefix = TriggerPrefix;
    this._archivePrefix = ArchivePrefix;
    this._attachmentPrefix = AttachmentPrefix;
    this._s3 = new aws.S3();

    console.info('Initialised');
  }

  handler = async (event: S3Event): Promise<void> => {
    console.info('Received Event:', JSON.stringify(event));

    // Handle S3 test events for example
    if (!event || !event.Records || event.Records.length === 0) {
      return;
    }

    const objectBeingProcessed: GetObjectRequest = {
      Bucket: event.Records[0].s3.bucket.name,
      Key: event.Records[0].s3.object.key,
    };

    const s3Object = await this._s3.getObject(objectBeingProcessed).promise();

    if(s3Object && s3Object.Body) {

      const dateString = (new Date()).toISOString().replace(/ /g, '-').replace(/:/g, '-');

      const parsed = await simpleParser(s3Object.Body);

      const s3Jobs = [];
      for (let i = 0; i < parsed.attachments.length; i++) { 
        console.log('Processing attachment: ', parsed.attachments[i]);

        const key = `${this._attachmentPrefix}${dateString}_${i}.jpg`;

        const putJob = this._s3.putObject({
            Bucket: objectBeingProcessed.Bucket,
            Key: key,
            Body: parsed.attachments[i].content,
          }).promise().then((r) => console.log('Put Result:', key, r));

        s3Jobs.push(putJob);
      }

      const newKey = objectBeingProcessed.Key.replace(this._triggerPrefix, this._archivePrefix);
      console.log('Copying ', objectBeingProcessed.Key, newKey);

      const copyJob = this._s3.copyObject({
          Bucket: objectBeingProcessed.Bucket,
          CopySource: `${objectBeingProcessed.Bucket}/${objectBeingProcessed.Key}`,
          Key: newKey,
        }).promise().then((r) => console.log('Copy Result:', r));

      s3Jobs.push(copyJob);

      await Promise.all(s3Jobs);

      console.log('All S3 jobs ran, now deleting source email object');

      const deleteResult = await this._s3.deleteObject({
        Bucket: objectBeingProcessed.Bucket,
        Key: objectBeingProcessed.Key,
      }).promise();

      console.log('Object Deleted', objectBeingProcessed.Key, deleteResult);

    } else {
      console.log('No email body to parse');
    }
  };
}

// Initialise class outside of the handler so context is reused.
const processEmail = new ProcessEmail();

// The handler simply executes the object handler
export const handler = async (event: S3Event): Promise<void> => processEmail.handler(event);
