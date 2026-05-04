# VDF Video Similarity Services Design

## 1. Purpose

This document defines the design for three services that integrate Video Duplicate Finder (VDF) into a video ingest pipeline.

The system receives newly ingested video events, prepares files for batch scanning, runs VDF periodically over pending scan files, exports similarity scan data, and persists normalized similarity groups into MongoDB.

The services are intentionally separated by responsibility:

1. **Video Scan Staging Service**  
   Reads new-video queue messages and copies video files from S3 into a mounted staging path waiting for VDF scan.

2. **VDF Batch Scan Service**  
   Periodically runs VDF against the staged video mount, exports scan results, forwards scan data to the grouping pipeline, and purges internal scan state for transferred files.

3. **Similarity Grouping Service**  
   Normalizes VDF scan output, maps files to Mongo video documents, creates similarity edges, and merges new results into existing similarity groups.

---

## 2. System Context

```txt
Video ingest pipeline
        |
        v
MongoDB videos collection
        |
        v
S3 video storage
        |
        v
New video queue
        |
        v
[1] Video Scan Staging Service
        |
        v
Mounted scan-waiting path
        |
        v
[2] VDF Batch Scan Service
        |
        v
Durable scan result storage
        |
        v
Lightweight scan-result queue
        |
        v
[3] Similarity Grouping Service
        |
        v
MongoDB similarity groups / edges / video updates
```

---

## 3. Shared Concepts

### 3.1 Video Identity

Every video must have a stable Mongo video identifier before entering this pipeline.

Required identity fields:

```ts
videoId: string
storageKey: string
bucket: string
```

Optional but recommended fields:

```ts
sha256?: string
fileSizeBytes?: number
durationMs?: number
contentType?: string
```

---

### 3.2 Scan File Naming

The staged file path must preserve a deterministic mapping back to the Mongo video document.

Recommended staged filename format:

```txt
{videoId}.{safeOriginalExtension}
```

Example:

```txt
/mnt/vdf/pending/6650a9f2c0a4b91c2f3d5e77.mp4
```

The `videoId` should be the authoritative identifier. Original filename should not be used as the source of truth.

---

### 3.3 Mount Paths

Recommended mount layout:

```txt
/mnt/vdf/
  pending/       # files waiting to be included in a scan
  active/        # files currently assigned to a scan batch
  completed/     # optional temporary post-scan location
  failed/        # optional files that failed preparation or scan
  manifests/     # scan manifests generated per batch
  exports/       # VDF result exports before durable upload
  locks/         # optional filesystem lock diagnostics only; Mongo/DB lock is authoritative
```

VDF scan output that is consumed by downstream services must be written to durable storage, such as S3 or another object store. Queue messages should reference the durable result location instead of embedding large scan result payloads.

The exact physical storage can be local disk, network storage, or a container-mounted volume.

---

### 3.4 Queue Contracts

The system uses two queues:

1. `video.scan.staging.requested`
2. `video.similarity.scan.completed` — lightweight message that points to durable scan result output

Optional dead-letter queues:

1. `video.scan.staging.failed`
2. `video.similarity.scan.failed`
3. `video.similarity.grouping.failed`

---

## 4. Service 1 — Video Scan Staging Service

## 4.1 Responsibility

The Video Scan Staging Service is responsible for preparing newly ingested videos for VDF scanning.

It reads messages from a queue, fetches video metadata from MongoDB, downloads or copies the corresponding file from S3, places the file into the VDF pending mount path, and updates the video scan status in MongoDB.

---

## 4.2 Out of Scope

This service must not:

- Run VDF.
- Compute similarity.
- Create similarity groups.
- Decide whether videos are duplicates.
- Delete source files from S3.
- Modify similarity group documents.

---

## 4.3 Input Queue

Queue name:

```txt
video.scan.staging.requested
```

Message schema:

```json
{
  "eventType": "video.scan.staging.requested",
  "eventId": "uuid",
  "videoId": "6650a9f2c0a4b91c2f3d5e77",
  "bucket": "video-ingest-bucket",
  "storageKey": "videos/2026/05/abc.mp4",
  "createdAt": "2026-05-04T00:00:00.000Z",
  "attempt": 1
}
```

Required fields:

- `eventId`
- `videoId`
- `bucket`
- `storageKey`

---

## 4.4 MongoDB Reads

The service reads from:

```txt
videos
```

Expected video document fields:

```json
{
  "_id": "ObjectId",
  "storage": {
    "bucket": "video-ingest-bucket",
    "key": "videos/2026/05/abc.mp4"
  },
  "scan": {
    "status": "pending"
  }
}
```

---

## 4.5 MongoDB Writes

Before copying:

```json
{
  "$set": {
    "scan.status": "staging",
    "scan.staging.startedAt": "ISODate",
    "scan.staging.source": "s3"
  }
}
```

After successful copy:

```json
{
  "$set": {
    "scan.status": "staged",
    "scan.staging.completedAt": "ISODate",
    "scan.staging.mountPath": "/mnt/vdf/pending/{videoId}.mp4"
  }
}
```

On failure:

```json
{
  "$set": {
    "scan.status": "staging_failed",
    "scan.staging.failedAt": "ISODate",
    "scan.staging.error": {
      "code": "S3_COPY_FAILED",
      "message": "Failed to copy video from S3",
      "retryable": true
    }
  }
}
```

---

## 4.6 File Operation Flow

```txt
1. Read queue message.
2. Validate required fields.
3. Load video document from MongoDB.
4. Verify video is eligible for staging.
5. Resolve staged filename using videoId.
6. Copy S3 object into a temporary local path.
7. Verify file exists and size is greater than zero.
8. Atomically move temp file into /mnt/vdf/pending.
9. Update Mongo video scan status to staged.
10. Acknowledge queue message.
```

Atomic write pattern:

```txt
/mnt/vdf/pending/.tmp/{eventId}.part
        ->
/mnt/vdf/pending/{videoId}.mp4
```

The final move should happen only after the copy is complete.

---

## 4.7 Idempotency

The service must be idempotent by `videoId`.

If the staged file already exists and Mongo status is `staged`, the service should acknowledge the message without copying again.

If the staged file exists but Mongo status is not `staged`, the service should verify file integrity and repair Mongo state where safe.

Recommended idempotency key:

```txt
staging:{videoId}
```

---

## 4.8 Failure Handling

Retryable failures:

- Temporary S3 read failure.
- Mongo transient error.
- Mount path temporarily unavailable.
- Queue visibility timeout.

Non-retryable failures:

- Mongo video document does not exist.
- S3 object does not exist.
- Unsupported video file extension, if extension validation is enforced.
- File is empty or invalid at source.

---

## 4.9 Service Output

This service does not need to publish another queue event if the VDF Batch Scan Service scans the mount periodically.

The durable output is:

1. A staged video file in `/mnt/vdf/pending`.
2. A Mongo video document with `scan.status = "staged"`.

---

# 5. Service 2 — VDF Batch Scan Service

## 5.1 Responsibility

The VDF Batch Scan Service periodically scans batches of staged videos using VDF.

It claims files from the pending mount using durable ownership, runs VDF over the active batch, exports scan result data, writes the normalized scan result to durable storage, emits a lightweight result-location event to the next queue, and purges VDF internal database data only after downstream grouping success or a configured recovery-safe retention expiry.

---

## 5.2 Out of Scope

This service must not:

- Copy videos from S3.
- Update final similarity groups.
- Decide canonical video IDs.
- Perform Mongo group merging.
- Delete original files from S3.
- Treat VDF results as final application truth.

---

## 5.3 Trigger

The service runs periodically.

Example scheduling policies:

```txt
Every 5 minutes
```

or

```txt
When pending file count >= batchSize
```

or a hybrid:

```txt
Run every 5 minutes, but skip if pending file count is 0.
Run immediately if pending file count >= 100.
```

---

## 5.4 Durable Batch Claiming

The service must avoid scanning files still being copied and must prevent multiple scanner instances from claiming the same files.

Only files in `/mnt/vdf/pending` without temporary suffixes should be eligible. Filesystem moves are not sufficient as the only ownership mechanism when more than one scanner instance can run. Batch ownership must be recorded in durable state before files are moved into the active folder.

Recommended Mongo collection:

```txt
video_similarity_scan_batches
```

Example scan batch document:

```json
{
  "_id": "ObjectId",
  "scanId": "scan_20260504_000001",
  "status": "claimed",
  "claimedBy": "vdf-scanner-03",
  "claimExpiresAt": "2026-05-04T00:15:00.000Z",
  "videoIds": ["6650a9f2c0a4b91c2f3d5e77"],
  "paths": {
    "activePath": "/mnt/vdf/active/scan_20260504_000001",
    "manifestPath": "/mnt/vdf/manifests/scan_20260504_000001.json",
    "exportPath": "/mnt/vdf/exports/scan_20260504_000001.json"
  },
  "createdAt": "2026-05-04T00:00:00.000Z",
  "updatedAt": "2026-05-04T00:00:00.000Z"
}
```

Allowed batch statuses:

```txt
claimed
moving_files
scanning
exported
published
grouping_completed
cleanup_completed
failed
expired
```

Claim flow:

```txt
1. List eligible files in /mnt/vdf/pending.
2. Resolve videoId from each eligible filename.
3. Atomically claim up to batchSize videos in Mongo using scan.status = staged and claimedBy = null.
4. Create scanId and insert video_similarity_scan_batches status=claimed.
5. Set each claimed video to scan.status = claimed, scan.currentScanId = scanId, scan.claimedBy = scannerInstanceId.
6. Move selected files into /mnt/vdf/active/{scanId}/.
7. Write scan manifest to /mnt/vdf/manifests/{scanId}.json.
8. Set batch status = scanning.
9. Run VDF against active batch plus configured reference library, if applicable.
```

The claim operation must be atomic per video. A video may only be claimed when its current state is eligible:

```json
{
  "_id": "ObjectId",
  "scan.status": "staged",
  "scan.claimedBy": null
}
```

The update should set ownership:

```json
{
  "$set": {
    "scan.status": "claimed",
    "scan.currentScanId": "scan_20260504_000001",
    "scan.claimedBy": "vdf-scanner-03",
    "scan.claimedAt": "ISODate",
    "scan.claimExpiresAt": "ISODate"
  }
}
```

If a scanner crashes after claiming, a reconciliation job may release or retry expired claims after `claimExpiresAt`, provided the active files are not currently being scanned.

Example manifest:

```json
{
  "scanId": "scan_20260504_000001",
  "createdAt": "2026-05-04T00:00:00.000Z",
  "claimedBy": "vdf-scanner-03",
  "files": [
    {
      "videoId": "6650a9f2c0a4b91c2f3d5e77",
      "path": "/mnt/vdf/active/scan_20260504_000001/6650a9f2c0a4b91c2f3d5e77.mp4"
    }
  ]
}
```

---

## 5.5 VDF Execution Scope

The scanner can operate in one of two modes.

### Mode A — Batch-Only Scan

The service compares files inside the current active batch only.

This is simpler but cannot detect similarity against older already-scanned videos unless those videos are also included in the scan set.

### Mode B — Batch Against Reference Library

The service compares new active files against a mounted reference library containing previously scanned videos.

Recommended for a live ingest pipeline.

Example layout:

```txt
/mnt/vdf/library/    # previously accepted/scanned videos
/mnt/vdf/active/     # current batch
```

The scan result must distinguish:

- New video vs new video.
- New video vs existing library video.
- Existing library video vs existing library video, if VDF outputs those pairs.

The grouping service should ignore unchanged existing-existing pairs unless they are needed for group repair.

---

## 5.6 VDF Output Contract

The service must convert raw VDF output into a stable internal result document and write that document to durable storage before publishing a queue message.

The queue message must stay lightweight. It should contain metadata and a pointer to the durable scan result, not the full match array. This avoids queue payload-size limits and makes grouping replayable.

Durable result object example:

```json
{
  "schemaVersion": "1.0",
  "scanId": "scan_20260504_000001",
  "scanner": {
    "name": "vdf",
    "version": "configured-runtime-version",
    "profile": "default-video-similarity-profile"
  },
  "createdAt": "2026-05-04T00:00:00.000Z",
  "scannedVideos": [
    {
      "videoId": "6650a9f2c0a4b91c2f3d5e77",
      "path": "/mnt/vdf/active/scan_20260504_000001/6650a9f2c0a4b91c2f3d5e77.mp4"
    }
  ],
  "matches": [
    {
      "leftVideoId": "6650a9f2c0a4b91c2f3d5e77",
      "rightVideoId": "6650a9f2c0a4b91c2f3d5e88",
      "leftPath": "/mnt/vdf/active/scan_20260504_000001/6650a9f2c0a4b91c2f3d5e77.mp4",
      "rightPath": "/mnt/vdf/library/6650a9f2c0a4b91c2f3d5e88.mp4",
      "score": 0.94,
      "relation": "similar",
      "confidence": "high",
      "raw": {
        "vdfMatchData": {}
      }
    }
  ]
}
```

Recommended durable storage path:

```txt
s3://internal-scan-results/vdf-results/{scanId}.json
```

Queue name:

```txt
video.similarity.scan.completed
```

Lightweight message schema:

```json
{
  "eventType": "video.similarity.scan.completed",
  "schemaVersion": "1.0",
  "eventId": "uuid",
  "scanId": "scan_20260504_000001",
  "scanner": {
    "name": "vdf",
    "version": "configured-runtime-version",
    "profile": "default-video-similarity-profile"
  },
  "resultLocation": {
    "type": "s3",
    "bucket": "internal-scan-results",
    "key": "vdf-results/scan_20260504_000001.json"
  },
  "scannedVideoIds": ["6650a9f2c0a4b91c2f3d5e77"],
  "createdAt": "2026-05-04T00:00:00.000Z"
}
```

Required queue-message fields:

- `eventType`
- `schemaVersion`
- `eventId`
- `scanId`
- `scanner.name`
- `resultLocation`
- `scannedVideoIds`

Required durable result fields:

- `schemaVersion`
- `scanId`
- `scanner.name`
- `scannedVideos`
- `matches`

Required match fields:

- `leftVideoId`
- `rightVideoId`
- `score`
- `relation`

---

## 5.7 MongoDB Updates

This service may update scan execution status on video documents, but it must not create final groups.

When a scan starts:

```json
{
  "$set": {
    "scan.status": "scanning",
    "scan.currentScanId": "scan_20260504_000001",
    "scan.startedAt": "ISODate"
  }
}
```

After durable scan result is written:

```json
{
  "$set": {
    "scan.status": "scan_exported",
    "scan.lastScanId": "scan_20260504_000001",
    "scan.exportedAt": "ISODate",
    "scan.resultLocation": {
      "type": "s3",
      "bucket": "internal-scan-results",
      "key": "vdf-results/scan_20260504_000001.json"
    }
  }
}
```

After the lightweight queue event is published:

```json
{
  "$set": {
    "scan.status": "scan_published",
    "scan.publishedAt": "ISODate"
  }
}
```

The final `similarity.status = completed` should be set by the Similarity Grouping Service after Mongo group updates succeed.

---

## 5.8 Recovery-Safe Purging of VDF Internal Data

The service must not purge local active files, export files, or VDF internal database state immediately after queue publish. Queue publish only proves that the grouping request was handed off. It does not prove that the grouping service successfully loaded the result, wrote edges, merged groups, and updated Mongo video state.

Purging may happen only after one of these conditions is true:

1. The Similarity Grouping Service marks the scan batch as `grouping_completed` in Mongo.
2. A configured retention window expires and the durable result object still exists for replay.
3. An operator explicitly forces cleanup for a failed or abandoned scan.

Recommended lifecycle:

```txt
scan completed
  -> result exported locally
  -> result uploaded to durable storage
  -> lightweight result event published
  -> grouping service persists edges/groups/video state
  -> grouping service marks scan batch grouping_completed
  -> scanner cleanup purges local/VDF state
  -> scan batch marked cleanup_completed
```

The service should purge:

- VDF internal metadata for active batch files.
- Temporary VDF scan cache for the batch, if safe.
- Local active batch files, according to the configured file lifecycle policy.
- Local export files after durable upload and retention rules are satisfied.

The service must not purge:

- Application Mongo data.
- S3 source video files.
- Durable scan result objects required for replay or audit.
- Reference-library files still needed for future scans.
- Local state for a batch that has not reached `grouping_completed`, unless retention-expiry cleanup is explicitly enabled.

Recommended purge record:

```json
{
  "scanId": "scan_20260504_000001",
  "purgedVideoIds": ["6650a9f2c0a4b91c2f3d5e77"],
  "purgedAt": "2026-05-04T00:00:00.000Z",
  "purgeStatus": "completed",
  "purgeReason": "grouping_completed"
}
```

---

## 5.9 File Lifecycle After Scan

After grouping has completed, or after a configured retention-safe cleanup condition is met, the service should either:

### Option A — Move scanned files into reference library

```txt
/mnt/vdf/active/{scanId}/{videoId}.mp4
        ->
/mnt/vdf/library/{videoId}.mp4
```

Use this if future scans need to compare new videos against already scanned videos.

### Option B — Delete active files

```txt
/mnt/vdf/active/{scanId}/{videoId}.mp4
        -> deleted
```

Use this only if another source of reference comparison exists or historical comparison is not required.

Recommended default:

```txt
Move successfully scanned files into /mnt/vdf/library.
```

---

## 5.10 Failure Handling

Retryable failures:

- VDF process exits unexpectedly.
- Temporary filesystem failure.
- Queue publish failure.
- Export file temporarily unavailable.

Non-retryable failures:

- Video cannot be decoded.
- File is corrupted.
- Video ID cannot be resolved from filename.
- Scan result cannot be normalized.

For failed files, move to:

```txt
/mnt/vdf/failed/{videoId}.mp4
```

and update Mongo:

```json
{
  "$set": {
    "scan.status": "scan_failed",
    "scan.error": {
      "code": "VDF_SCAN_FAILED",
      "message": "VDF could not process this video",
      "retryable": false
    }
  }
}
```

---

# 6. Service 3 — Similarity Grouping Service

## 6.1 Responsibility

The Similarity Grouping Service consumes normalized VDF scan result events, transforms them into MongoDB persistence models, creates similarity edges, and merges affected videos into similarity groups.

This service owns the final application-level similarity state.

---

## 6.2 Out of Scope

This service must not:

- Run VDF.
- Copy files from S3.
- Move files between mount folders.
- Delete VDF internal database records.
- Decode or inspect video files.

---

## 6.3 Input Queue

Queue name:

```txt
video.similarity.scan.completed
```

The input message is a lightweight scan-completed event produced by the VDF Batch Scan Service. The grouping service must load the full normalized result payload from `resultLocation` before writing Mongo similarity state.

---

## 6.4 MongoDB Collections

This service writes to these collections:

```txt
videos
video_similarity_edges
video_similarity_groups
video_similarity_scan_events
```

---

## 6.5 `video_similarity_scan_events`

Stores raw normalized scan event payloads for audit, replay, and debugging.

Example:

```json
{
  "_id": "ObjectId",
  "eventId": "uuid",
  "scanId": "scan_20260504_000001",
  "scanner": {
    "name": "vdf",
    "version": "configured-runtime-version",
    "profile": "default-video-similarity-profile"
  },
  "resultLocation": {
    "type": "s3",
    "bucket": "internal-scan-results",
    "key": "vdf-results/scan_20260504_000001.json"
  },
  "payloadHash": "sha256:...",
  "status": "processed",
  "createdAt": "ISODate",
  "processedAt": "ISODate"
}
```

Unique index:

```txt
eventId unique
```

---

## 6.6 `video_similarity_edges`

Stores pairwise similarity results.

Example:

```json
{
  "_id": "ObjectId",
  "scanId": "scan_20260504_000001",
  "leftVideoId": "ObjectId",
  "rightVideoId": "ObjectId",
  "score": 0.94,
  "relation": "similar",
  "confidence": "high",
  "source": "vdf",
  "createdAt": "ISODate"
}
```

Recommended unique index:

```txt
source + leftVideoId + rightVideoId + scanId
```

To avoid duplicate reversed edges, normalize pair order before writing:

```txt
leftVideoId = min(videoAId, videoBId)
rightVideoId = max(videoAId, videoBId)
```

---

## 6.7 `video_similarity_groups`

Stores connected similarity clusters.

Example:

```json
{
  "_id": "ObjectId",
  "canonicalVideoId": "ObjectId",
  "memberVideoIds": ["ObjectId"],
  "members": [
    {
      "videoId": "ObjectId",
      "role": "canonical",
      "scoreToCanonical": 1.0,
      "joinedAt": "ISODate"
    },
    {
      "videoId": "ObjectId",
      "role": "similar",
      "scoreToCanonical": 0.94,
      "joinedAt": "ISODate"
    }
  ],
  "source": "vdf",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

Recommended index:

```txt
memberVideoIds
canonicalVideoId
updatedAt
```


---

## 6.8 Similarity Threshold Policy

The grouping service must use separate thresholds for storing pairwise edges and for automatically merging groups.

Storing an edge means the system preserves a candidate similarity relationship for audit, review, or future analysis. Merging a group means the system changes application-level grouping state. Group merging is higher impact and should require a stricter threshold.

Recommended policy fields:

```yaml
similarityPolicy:
  storeEdgeScore: 0.88
  groupMergeScore: 0.93
  exactDuplicateScore: 0.98
  weakSimilarScore: 0.88
  strongSimilarScore: 0.93
  requireManualReviewBelow: 0.93
```

Rules:

```txt
score < storeEdgeScore
  -> discard or store only in raw scan payload

storeEdgeScore <= score < groupMergeScore
  -> store video_similarity_edges
  -> do not automatically merge groups
  -> mark as candidate/review edge

score >= groupMergeScore
  -> store video_similarity_edges
  -> eligible for automatic group creation or group merge

score >= exactDuplicateScore
  -> mark relation/confidence as near-exact when supported by VDF output
```

The value used for `groupMergeScore` must be recorded on every merge decision so future threshold changes can be audited or replayed.

---

## 6.9 Group Merge Rules

The grouping service receives pairwise matches and converts only merge-eligible matches into connected groups.

If a merge-eligible match connects two videos that are not in any group:

```txt
Create a new group containing both videos.
```

If one video is already in a group and the other is not:

```txt
Add the ungrouped video to the existing group.
```

If both videos are in the same group:

```txt
Do not create a new group. Update edge data only.
```

If both videos are in different groups and the connecting edge meets `groupMergeScore`:

```txt
Merge both groups into one group.
```

If the connecting edge is below `groupMergeScore`, preserve the edge but do not merge the groups automatically.

The merged group should preserve all members and edges.

---

## 6.10 Grouping Algorithm

Use connected components over similarity edges that are eligible for automatic grouping. Edges below `groupMergeScore` may be stored, but they must not participate in automatic group merges unless an operator or later policy promotes them.

Input:

```json
[
  { "leftVideoId": "A", "rightVideoId": "B", "score": 0.97 },
  { "leftVideoId": "B", "rightVideoId": "C", "score": 0.93 },
  { "leftVideoId": "D", "rightVideoId": "E", "score": 0.95 }
]
```

Output:

```txt
Group 1: A, B, C
Group 2: D, E
```

The service should compute affected components using:

1. New scan edges with `score >= groupMergeScore`.
2. Existing merge-eligible edges for any video touched by the new scan.
3. Existing groups containing any touched video.

This prevents partial updates from breaking existing groups.

---

## 6.11 Canonical Video Selection

Canonical video selection should be deterministic.

Recommended priority:

1. Highest quality video, if quality metadata exists.
2. Longest duration, if partial clips should not become canonical.
3. Largest resolution.
4. Largest file size.
5. Earliest ingest date.
6. Lowest ObjectId as final tie-breaker.

The canonical video can change when a better video enters the group.

---

## 6.12 Video Document Updates

Each video document should receive a lightweight similarity summary.

Example:

```json
{
  "$set": {
    "similarity.status": "completed",
    "similarity.groupId": "ObjectId",
    "similarity.scannedAt": "ISODate",
    "similarity.source": "vdf",
    "similarity.matchCount": 4,
    "scan.status": "completed"
  }
}
```

Optional embedded top matches:

```json
{
  "similarity.topMatches": [
    {
      "videoId": "ObjectId",
      "score": 0.97,
      "relation": "similar"
    }
  ]
}
```

Do not embed the full similarity graph in every video document if groups can become large.

---

## 6.13 Idempotency

The service must be idempotent by `eventId`.

If a scan event was already processed successfully, the service should acknowledge the message and do nothing.

Processing states:

```txt
received
processing
processed
failed
```

Recommended flow:

```txt
1. Insert scan event with unique eventId and status=processing.
2. If duplicate key exists and status=processed, acknowledge.
3. Load full scan result from `resultLocation`.
4. Validate result schema and payload hash, if provided.
5. Write all qualifying edges using `storeEdgeScore`.
6. Merge groups only using edges that meet `groupMergeScore`.
7. Update videos.
8. Mark scan event as processed.
9. Mark the matching scan batch as `grouping_completed`.
10. Acknowledge queue message.
```

---

## 6.14 Transaction Boundary

If MongoDB replica set transactions are available, wrap the following in one transaction:

```txt
- Insert/update scan event processing state.
- Insert similarity edges.
- Create/update/merge similarity groups.
- Update affected videos.
- Mark scan event processed.
- Mark scan batch grouping_completed.
```

If transactions are not available, use idempotent upserts and repairable processing states.

---

## 6.15 Failure Handling

Retryable failures:

- Mongo write conflict.
- Temporary Mongo outage.
- Queue visibility timeout.
- Lock acquisition failure.

Non-retryable failures:

- Invalid scan payload schema.
- Missing required video IDs.
- Referenced video documents do not exist.
- Score is outside accepted range.

Invalid events should be stored as failed scan events and routed to a dead-letter queue.

---

# 7. Cross-Service Contracts

## 7.1 Status Flow

```txt
pending
  -> staging
  -> staged
  -> scanning
  -> scan_exported
  -> scan_published
  -> grouping
  -> completed
  -> cleanup_completed
```

Failure states:

```txt
staging_failed
scan_failed
grouping_failed
```

---

## 7.2 Ownership Matrix

| Concern | Staging Service | VDF Batch Scan Service | Similarity Grouping Service |
|---|---:|---:|---:|
| Read new-video queue | Yes | No | No |
| Copy from S3 | Yes | No | No |
| Write pending scan file | Yes | No | No |
| Claim scan batch | No | Yes | No |
| Run VDF | No | Yes | No |
| Normalize raw VDF output | No | Yes | No |
| Write durable scan result object | No | Yes | No |
| Publish lightweight result-location event | No | Yes | No |
| Load durable scan result object | No | No | Yes |
| Mark grouping completion | No | No | Yes |
| Purge VDF internal DB data after safe acknowledgment | No | Yes | No |
| Create similarity edges | No | No | Yes |
| Merge similarity groups | No | No | Yes |
| Update final video similarity state | No | No | Yes |

---

## 7.3 Required Observability

Each service should emit logs and metrics with:

```txt
videoId
scanId
eventId
serviceName
status
errorCode
latencyMs
```

Recommended metrics:

```txt
staging_messages_processed_total
staging_copy_failures_total
vdf_batches_started_total
vdf_batches_completed_total
vdf_scan_duration_seconds
vdf_matches_found_total
grouping_events_processed_total
grouping_group_merges_total
grouping_failures_total
```

---

# 8. Operational Rules

## 8.1 Backpressure

The staging service should stop or slow copying when:

```txt
/mnt/vdf/pending file count exceeds maxPendingFiles
```

or

```txt
free disk space drops below minimumFreeDiskBytes
```

---

## 8.2 Disk Safety

The VDF mount must have cleanup rules for:

- Orphan temporary files.
- Old failed files.
- Expired export files.
- Abandoned active scan folders.

Cleanup must not delete files currently claimed by an active scan.

---

## 8.3 Reprocessing

The system should support reprocessing a video by emitting a new staging request with a new `eventId` and a `forceRescan` flag.

Example:

```json
{
  "eventType": "video.scan.staging.requested",
  "eventId": "uuid",
  "videoId": "6650a9f2c0a4b91c2f3d5e77",
  "bucket": "video-ingest-bucket",
  "storageKey": "videos/2026/05/abc.mp4",
  "forceRescan": true
}
```

The grouping service should preserve old scan events and write new edges with a new `scanId`.

---

# 9. Acceptance Criteria

## 9.1 Staging Service

The service is complete when:

- It consumes new-video queue messages.
- It validates required message fields.
- It loads the matching Mongo video document.
- It copies the video from S3 to the pending scan mount.
- It writes files atomically.
- It updates Mongo scan status to `staged`.
- It handles retries and idempotent duplicate messages.

---

## 9.2 VDF Batch Scan Service

The service is complete when:

- It periodically claims staged videos from the pending mount.
- It moves claimed files into an active scan folder.
- It runs VDF over the configured scan scope.
- It claims batches using durable ownership and prevents duplicate scanner claims.
- It exports or extracts VDF scan results.
- It normalizes scan results into the internal durable result contract.
- It writes normalized scan results to durable storage.
- It publishes a lightweight scan completed event containing `scanId` and `resultLocation`.
- It purges VDF internal DB data only after grouping success or configured retention-safe cleanup.
- It moves or deletes scanned files according to the configured file lifecycle policy.

---

## 9.3 Similarity Grouping Service

The service is complete when:

- It consumes lightweight VDF scan result events.
- It loads the full normalized scan result from durable storage.
- It stores scan event records for audit and idempotency.
- It writes normalized pairwise similarity edges that meet `storeEdgeScore`.
- It creates new groups only from edges that meet `groupMergeScore`.
- It adds new videos to existing groups only from edges that meet `groupMergeScore`.
- It merges groups only when a merge-eligible edge connects them.
- It updates each affected video document with final similarity status and group ID.
- It handles duplicate events safely.

---

# 10. Open Configuration

Recommended configuration values:

```yaml
staging:
  pendingPath: "/mnt/vdf/pending"
  tempPath: "/mnt/vdf/pending/.tmp"
  maxPendingFiles: 10000
  minimumFreeDiskBytes: 50000000000

vdfScanner:
  schedule: "*/5 * * * *"
  batchSize: 100
  activePath: "/mnt/vdf/active"
  libraryPath: "/mnt/vdf/library"
  manifestsPath: "/mnt/vdf/manifests"
  exportsPath: "/mnt/vdf/exports"
  moveScannedFilesToLibrary: true
  durableResultStorage:
    type: "s3"
    bucket: "internal-scan-results"
    prefix: "vdf-results/"
  batchClaimTtlSeconds: 900
  purgeInternalDbAfterGroupingCompleted: true
  purgeInternalDbAfterRetentionExpiry: false
  localExportRetentionHours: 24

grouping:
  similarityPolicy:
    storeEdgeScore: 0.88
    groupMergeScore: 0.93
    exactDuplicateScore: 0.98
    weakSimilarScore: 0.88
    strongSimilarScore: 0.93
    requireManualReviewBelow: 0.93
  storeRawScanPayload: true
  maxEmbeddedTopMatches: 10
  canonicalSelectionPolicy:
    - highest_quality
    - longest_duration
    - largest_resolution
    - largest_file_size
    - earliest_ingest_date
    - lowest_object_id
```
