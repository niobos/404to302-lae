404to302 for Amazon CloudFront
==============================

This repo contains Lambda@Edge code to perform the [404to302] rewriting.

[404to302]: https://4042302.org/

Install instructions
--------------------

 1. Build the ZIP file to deploy by running `./build-js.sh`
 2. Upload the ZIP file to an S3 bucket in region `us-east-1`
 3. Create a CloudFormation stack based on the `404to302.cfn.yaml` template.
    Fill in the chosen S3 bucket, and the chosen filename.
    The stack _outputs_ the ARN of the created Lambda function.
 4. Configure your CloudFront Distribution to call this Lambda on
    Origin Response.
 5. Add a Tag to the Distribution with key `FallbackLocation`, and value
    the URL you want to redirect to. This URL undergoes some substitution;
    see the top of `index.js` to see what you can use. Typically, you'll
    want `https://old.example.org@path@?@query@`

Optionally, you can use the provided `static-website.cfn.yaml`
CloudFormation template to set up an S3 bucket with the 404to302 config.
This will do steps 4 and 5 for you.