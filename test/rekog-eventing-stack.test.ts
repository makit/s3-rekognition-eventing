import * as cdk from 'aws-cdk-lib';
import { RekogEventingStack } from '../lib/stacks/rekog-eventing-stack';
import { Template } from 'aws-cdk-lib/assertions';
// import * as Cdk from '../lib/cdk-stack';

test('S3 Bucket Created With Configured Expiration', () => {
  const expireObjectsAfterXDays = 5;
  
  const app = new cdk.App();

  // WHEN
  const stack = new RekogEventingStack(app, 'RekogEventingStack', {
    algorithmMaxLabels: 5,
    algorithmMinConfidence: 70,
    expireObjectsAfterXDays,
  });

  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::S3::Bucket', {
    LifecycleConfiguration: {
      Rules: [
        {
          ExpirationInDays: expireObjectsAfterXDays,
        }
      ]
    }
  });
});
