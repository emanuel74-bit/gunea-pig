# Prompt: Generate System Requirements for VDF-Based Video Similarity Pipeline

You are a senior backend architect and system requirements analyst.

Your task is to write a **system requirements document**, not an implementation design, for a video similarity pipeline that uses **Video Duplicate Finder / VDF** to detect similar videos after ingestion.

The output must be written in Markdown.

Do not write code.
Do not write implementation details unless they are required to express a requirement.
Do not over-design the internals.
Focus on clear, testable, enforceable system requirements.

---

# 1. Technology Constraints

The system must be implemented using:

- TypeScript
- NestJS
- Node.js version `18.8.0`
- RabbitMQ as the queue/message broker
- MongoDB as the main persistence layer
- S3-compatible object storage for video files and durable scan result payloads
- VDF / Video Duplicate Finder as the similarity scan engine

The generated requirements must explicitly mention these technology constraints.

---

# 2. System Goal

The system must process videos that have already entered a video ingest pipeline.

For each ingested video:

1. Metadata already exists in MongoDB.
2. The original video file already exists in S3.
3. A RabbitMQ message is emitted when a new video is ready for similarity scanning.
4. The system must stage the video into a mounted filesystem path used by VDF.
5. The system must periodically run VDF over batches of staged videos.
6. The system must export normalized VDF scan results.
7. The system must persist similarity relationships and group membership information in MongoDB.
8. The system must merge new similarity results with existing video similarity groups.
9. The system must support safe cleanup of local scan files and VDF internal state.

---

# 3. Required Services

The requirements document must describe requirements for exactly these three services.

## 3.1 Video Scan Staging Service

This service reads RabbitMQ messages about newly ingested videos.

The message contains enough information to identify the video metadata in MongoDB and locate the video file in S3.

The service must:

- Read new-video scan messages from RabbitMQ.
- Load the video metadata from MongoDB.
- Verify that the referenced S3 object exists.
- Copy or materialize the video file from S3 into a mounted filesystem path for videos waiting to be scanned.
- Mark the video scan state in MongoDB.
- Ensure idempotent behavior when the same RabbitMQ message is delivered more than once.
- Avoid staging the same video multiple times.
- Report failures clearly when MongoDB metadata is missing, the S3 object is missing, or the file cannot be copied.
- Publish or mark the video as ready for batch scanning.

The service must not run VDF directly.
The service must not modify similarity groups.

---

## 3.2 VDF Batch Scanner Service

This service applies VDF to the mounted scan path.

The service must:

- Periodically claim a batch of staged videos for scanning.
- Use VDF to scan claimed videos against the configured scan set or reference library.
- Produce normalized scan output containing video-to-video similarity relationships.
- Store the normalized scan output in durable storage, preferably S3-compatible object storage.
- Publish a lightweight RabbitMQ event containing the scan identifier and durable result location.
- Avoid publishing large scan results directly inside RabbitMQ messages.
- Maintain clear scan status transitions in MongoDB.
- Support retryable failure handling.
- Prevent multiple scanner instances from claiming the same batch.

The service must purge local scan state and VDF internal state only after the downstream grouping service has successfully persisted the scan result, or after a defined retention/expiry policy allows cleanup.

The service must not directly merge similarity groups.
The service must not treat RabbitMQ publish success as proof that scan results were persisted into MongoDB.

---

## 3.3 Similarity Grouping Service

This service formats scan results for MongoDB and updates similarity groups.

The service must:

- Read scan-completed events from RabbitMQ.
- Load the normalized scan result payload from the durable result location.
- Validate the scan result schema and version.
- Convert VDF scan output into MongoDB similarity edges.
- Store similarity edges between videos.
- Merge videos into existing similarity groups when the configured merge threshold is met.
- Create new similarity groups when needed.
- Update each affected video document with its similarity status, group information, and relevant match summaries.
- Handle videos with no matches by marking them as successfully scanned with zero matches.
- Confirm successful persistence so that scanner cleanup can safely proceed.
- Be idempotent when the same scan-completed event is received more than once.

The service must not run VDF.
The service must not copy files from S3.
The service must not depend on VDF internal state as the source of truth.

---

# 4. RabbitMQ Requirements

The requirements document must include RabbitMQ messaging requirements.

At minimum, define requirements for these message flows:

## 4.1 New Video Ready for Scan

Produced by the ingest pipeline or upstream service.

Consumed by the Video Scan Staging Service.

The message must include:

- event ID
- schema version
- video ID
- S3 object reference
- timestamp
- correlation ID or trace ID

## 4.2 Scan Completed

Produced by the VDF Batch Scanner Service.

Consumed by the Similarity Grouping Service.

The message must include:

- event ID
- schema version
- scan ID
- durable result location
- list of scanned video IDs or a reference to them
- scanner profile/version
- timestamp
- correlation ID or trace ID

The scan-completed message must not contain a large inline result payload.

## 4.3 Scan Persisted / Grouping Completed

Produced by the Similarity Grouping Service or represented as a MongoDB state transition.

Used by the VDF Batch Scanner Service or cleanup process.

The message or state transition must indicate that the scan result was successfully persisted and that cleanup is now allowed.

---

# 5. Durable Result Handoff Requirement

The system must use a durable handoff between the VDF Batch Scanner Service and the Similarity Grouping Service.

The VDF Batch Scanner Service must:

- Write normalized scan results to durable storage.
- Publish only a lightweight RabbitMQ event containing the scan ID and result location.
- Ensure the result payload can be reloaded if the grouping service retries.
- Keep the result available until grouping succeeds or the retention period expires.

RabbitMQ must not be used as the storage mechanism for large scan result payloads.

---

# 6. Durable Batch Claiming Requirement

The VDF Batch Scanner Service must use durable batch claiming.

The system must prevent multiple scanner workers from processing the same video or the same scan batch at the same time.

The requirements must specify that batch ownership must be recorded in a durable store, such as MongoDB.

The batch claim must include:

- scan ID
- claimed video IDs
- owner ID
- claim timestamp
- claim expiration timestamp
- status

The system must support recovery of expired or abandoned claims.

Filesystem moves alone must not be considered sufficient as the only locking mechanism.

---

# 7. Safe Cleanup / Purge Requirement

The VDF Batch Scanner Service must not purge local scan files, VDF internal database state, temporary exports, or scan artifacts immediately after publishing the scan-completed RabbitMQ event.

Cleanup is allowed only after one of the following:

1. The Similarity Grouping Service has successfully persisted the scan result and acknowledged grouping completion.
2. A configured retention period has expired and the system has recorded the scan as safely expired or unrecoverable according to policy.

The requirements must include cleanup states such as:

- pending cleanup
- cleanup allowed
- cleaned
- cleanup failed

The system must retain enough information to retry grouping before cleanup occurs.

---

# 8. Similarity Threshold Policy Requirement

The system must support separate thresholds for:

1. Storing similarity edges.
2. Automatically merging videos into similarity groups.

The edge-storage threshold may be lower than the group-merge threshold.

Example policy:

```yaml
similarityPolicy:
  storeEdgeScore: 0.88
  autoMergeGroupScore: 0.93
  strongDuplicateScore: 0.98
  requireManualReviewBelow: 0.93