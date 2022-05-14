#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RekogEventingStack } from '../lib/stacks/rekog-eventing-stack';

const app = new cdk.App();

// Could make this inputs as context values
new RekogEventingStack(app, 'RekognitionEventingStack', {
  expireObjectsAfterXDays: 2,
  algorithmMinConfidence: 78,
  algorithmMaxLabels: 15,

  // If this email is configured to send to SES (https://docs.aws.amazon.com/ses/latest/dg/receiving-email-setting-up.html)
  // then the below being set will add the corresponding resources to deliver email to a bucket, and the 
  // attachments will drive the application
  emailRecipient: 'test@github.com',
});