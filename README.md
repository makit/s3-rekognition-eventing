# AWS S3 Rekognition Processing With Events

This project contains a [CDK](https://docs.aws.amazon.com/cd) application that builds a AWS application utilising [S3](https://aws.amazon.com/s3/), [SNS](https://aws.amazon.com/sns/), [SQS](https://aws.amazon.com/sqs/), [Lambda](https://aws.amazon.com/lambda/) [EventBridge](https://aws.amazon.com/eventbridge/) and [Rekognition](https://aws.amazon.com/rekognition/) which will trigger when images are placed within a bucket, detect objects in the images and then fire events with these object labels that are then filtered to specific priority based topics for notifications.

## Example Use Case
Snapshots of movement could be uploaded to S3 - or extracted from email attachments by [SES](https://aws.amazon.com/ses/) into S3 - and then depending on the objects that are detected it could send a Text Message, send an email, or do nothing. For example, a person detected could be a text and email. A dog could trigger an email only, and a bird could simply not notify at all.

This can easily be expanded to store the images, along with labels into an archive for later quering with [Athena](https://aws.amazon.com/athena/) as well.

## Diagram

![Diagram](diagram.png)