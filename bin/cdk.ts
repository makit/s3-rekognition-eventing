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
});