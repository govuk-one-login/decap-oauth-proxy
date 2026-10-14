# Deployment

## Approach

This service deploys via a modified [Secure Pipelines](https://govukverify.atlassian.net/wiki/spaces/PLAT/pages/3052077059/Secure+Delivery+Pipelines) with a **single production environment**.

On merge to `main`:
1. GitHub Actions runs tests, type checks, and lints
2. esbuild bundles `src/handler.ts` into `dist/handler.mjs`
3. `devplatform-upload-action` packages the artifact, signs it via AWS Signer, and uploads to S3
4. The Secure Pipeline (CodePipeline) in the production account deploys the CloudFormation stack

## Environment model

This proxy uses **build → production** only (two accounts).

This is a conscious divergence from the standard Secure Pipelines model of build → staging → integration → production. The rationale:

- The proxy is stateless with no user data
- It has two endpoints with a simple, well-tested contract
- It serves docs-site CMS editors, not end-user traffic
- The team-manual (which this initially supports) follows the same single-environment pattern

If this proxy evolves to serve a broader range of services with a different profile, the environment model should be revisited. However it's expected to be resilient as it's mostly of benefit as an aid to itnernal tooling where we store state in repos.

## Alternatives considered

### Option A: Full Secure Pipelines with SAM (4 environments)

Convert to SAM template, deploy through build → staging → integration → production with separate AWS accounts for each.

- **Pro:** Maximum compliance with org standards
- **Con:** Disproportionate for a 2-endpoint stateless proxy; 4 AWS accounts and pipeline stacks for something that could be a single Lambda
- **Decision:** Not justified at current scale. Upgrade path is clear if needed.

### Option B: Raw CF + Secure Pipelines upload (chosen)

Keep raw CloudFormation, use `devplatform-upload-action` for artifact upload, deploy to build + production only.

- **Pro:** Uses Secure Pipelines tooling (signed artifacts, CodePipeline deployment), minimal infrastructure, matches the simplicity of the service
- **Con:** Slight divergence from SAM-native workflow (no `sam build`)
- **Decision:** Chosen. Pragmatic balance of compliance and simplicity.

### Option C: Docker container + ECR (team-manual pattern)

Essentially do what we do in the Team Manual.

Package the Lambda as a container image, push to ECR via `devplatform-upload-action-ecr`.

- **Pro:** Identical deployment pattern to the team-manual
- **Con:** Docker is designed for long-running containers (Fargate/ECS). Packaging a single `.mjs` file in a container image adds unnecessary build time, image size, and complexity. The team-manual uses containers because it runs nginx on Fargate — we're deploying a Lambda.
- **Decision:** Rejected. Wrong abstraction for serverless.

## Required secrets

Configure these in the GitHub repository Settings → Secrets → Actions:

| Secret | Source |
|--------|--------|
| `AWS_ROLE_TO_ASSUME` | CloudFormation output `GitHubActionsRoleArn` from the pipeline stack |
| `ARTIFACT_BUCKET` | CloudFormation output `GitHubArtifactSourceBucketName` from the pipeline stack |
| `SIGNING_PROFILE_NAME` | From the AWS Signer stack in the build account |

## AWS account setup

Follow [How to prepare AWS accounts for containing SAM deployment pipelines](https://govukverify.atlassian.net/wiki/spaces/PLAT/pages/3059908609) to set up the build and production accounts, then provision the `sam-deploy-pipeline` stack pointing at this repository.
