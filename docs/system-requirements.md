# System Requirements: VDF-Based Video Similarity Pipeline

**Version:** 1.0  
**Status:** Draft

---

## 1. Technology Constraints

The system must be implemented using the following technologies:

| Constraint | Value |
|---|---|
| Language | TypeScript |
| Framework | NestJS |
| Runtime | Node.js `18.8.0` |
| Message Broker | RabbitMQ |
| Primary Persistence | MongoDB |
| Object Storage | S3-compatible (videos and scan result payloads) |
| Similarity Scan Engine | VDF / Video Duplicate Finder |

All three services defined in this document must adhere to these constraints. No alternative runtime, broker, or persistence layer may be introduced without an explicit requirement change.

---

## 2. System Goal

The system processes videos that have already completed a video ingest pipeline. By the time the system receives a video, the following preconditions are guaranteed:

1. Video metadata already exists in MongoDB.
2. The original video file already exists in S3-compatible object storage.
3. A RabbitMQ message has been emitted signalling that the video is ready for similarity scanning.

Given those preconditions, the system must:

1. Stage the video into a mounted filesystem path used by VDF.
2. Periodically run VDF over batches of staged videos.
3. Export and normalize VDF scan results.
4. Persist similarity relationships and group membership information in MongoDB.
5. Merge new similarity results with existing video similarity groups.
6. Support safe, policy-gated cleanup of local scan files and VDF internal state.

---

## 3. Services

The system must be composed of exactly three services. Each service must have a single, clearly bounded responsibility. No service may cross into another service's responsibility boundary.

---

### 3.1 Video Scan Staging Service

**Responsibility:** Consume ingest-ready events and materialize video files into the VDF scan path.

#### 3.1.1 Functional Requirements

| ID | Requirement |
|---|---|
| VSS-F-001 | The service must consume `new-video-ready-for-scan` messages from RabbitMQ. |
| VSS-F-002 | The service must load video metadata from MongoDB using the video ID from the message. |
| VSS-F-003 | The service must verify that the referenced S3 object exists before attempting to copy it. |
| VSS-F-004 | The service must copy or materialize the video file from S3 into the configured mounted filesystem path for staged videos. |
| VSS-F-005 | The service must record the video scan state in MongoDB after successful staging. |
| VSS-F-006 | The service must mark the video as ready for batch scanning after successful staging. |

#### 3.1.2 Idempotency Requirements

| ID | Requirement |
|---|---|
| VSS-I-001 | The service must be idempotent. If the same RabbitMQ message is delivered more than once, the service must not stage the same video a second time. |
| VSS-I-002 | The service must check existing scan state in MongoDB before staging to detect and skip already-staged videos. |

#### 3.1.3 Failure Requirements

| ID | Requirement |
|---|---|
| VSS-E-001 | The service must report a clear, structured failure when MongoDB metadata for the given video ID is missing. |
| VSS-E-002 | The service must report a clear, structured failure when the referenced S3 object does not exist. |
| VSS-E-003 | The service must report a clear, structured failure when the file cannot be copied to the staging path. |

#### 3.1.4 Boundary Constraints

| ID | Constraint |
|---|---|
| VSS-B-001 | The service must not invoke VDF directly. |
| VSS-B-002 | The service must not create, update, or delete similarity groups. |

---

### 3.2 VDF Batch Scanner Service

**Responsibility:** Claim batches of staged videos, run VDF, produce normalized scan results, and publish lightweight scan-completed events.

#### 3.2.1 Functional Requirements

| ID | Requirement |
|---|---|
| VBS-F-001 | The service must periodically claim a batch of staged videos for scanning. |
| VBS-F-002 | The service must use VDF to scan all claimed videos against the configured scan set or reference library. |
| VBS-F-003 | The service must produce normalized scan output containing video-to-video similarity relationships. |
| VBS-F-004 | The service must write normalized scan results to durable S3-compatible object storage. |
| VBS-F-005 | The service must publish a lightweight `scan-completed` RabbitMQ event containing the scan ID and the durable result location. |
| VBS-F-006 | The service must maintain clear scan status transitions in MongoDB throughout the scan lifecycle. |
| VBS-F-007 | The service must support retryable failure handling for failed scan attempts. |

#### 3.2.2 Durable Batch Claiming Requirements

| ID | Requirement |
|---|---|
| VBS-C-001 | The service must record batch ownership in a durable store (MongoDB) before beginning a scan. |
| VBS-C-002 | Multiple scanner worker instances must not be able to claim the same batch or the same video concurrently. |
| VBS-C-003 | Each batch claim record must include: scan ID, claimed video IDs, owner ID, claim timestamp, claim expiration timestamp, and status. |
| VBS-C-004 | The service must support recovery of expired or abandoned claims. A claim past its expiration timestamp must be reclaimable by another worker. |
| VBS-C-005 | Filesystem-level moves alone must not be used as the sole locking or ownership mechanism. |

#### 3.2.3 Durable Result Handoff Requirements

| ID | Requirement |
|---|---|
| VBS-H-001 | Normalized scan results must be written to durable S3-compatible storage before the `scan-completed` event is published. |
| VBS-H-002 | The `scan-completed` RabbitMQ message must not contain large inline scan result payloads. |
| VBS-H-003 | The result payload must remain available in durable storage until the grouping service confirms successful persistence or the configured retention period expires. |
| VBS-H-004 | The result payload must be reloadable if the grouping service retries processing the `scan-completed` event. |

#### 3.2.4 Safe Cleanup Requirements

| ID | Requirement |
|---|---|
| VBS-P-001 | The service must not purge local scan files, VDF internal database state, temporary scan exports, or scan artifacts immediately after publishing the `scan-completed` event. |
| VBS-P-002 | Cleanup is allowed only after one of the following conditions is met: (a) the Similarity Grouping Service has successfully persisted the scan result and acknowledged grouping completion; or (b) a configured retention period has expired and the scan has been recorded as safely expired or unrecoverable according to policy. |
| VBS-P-003 | The system must track cleanup state for each scan. Valid cleanup states are: `pending_cleanup`, `cleanup_allowed`, `cleaned`, `cleanup_failed`. |
| VBS-P-004 | The system must retain enough information to retry grouping before cleanup occurs. |

#### 3.2.5 Boundary Constraints

| ID | Constraint |
|---|---|
| VBS-B-001 | The service must not directly merge similarity groups. |
| VBS-B-002 | The service must not treat a successful RabbitMQ publish as proof that scan results have been persisted in MongoDB. |

---

### 3.3 Similarity Grouping Service

**Responsibility:** Load normalized scan results, persist similarity edges, and maintain similarity group membership in MongoDB.

#### 3.3.1 Functional Requirements

| ID | Requirement |
|---|---|
| SGS-F-001 | The service must consume `scan-completed` events from RabbitMQ. |
| SGS-F-002 | The service must load the normalized scan result payload from the durable result location referenced in the event. |
| SGS-F-003 | The service must validate the scan result schema and version before processing. |
| SGS-F-004 | The service must convert VDF scan output into MongoDB similarity edge documents. |
| SGS-F-005 | The service must store similarity edges between videos in MongoDB. |
| SGS-F-006 | The service must merge videos into an existing similarity group when the configured merge threshold is met. |
| SGS-F-007 | The service must create a new similarity group when no existing group meets the merge threshold. |
| SGS-F-008 | The service must update each affected video document with its similarity status, group membership, and relevant match summaries. |
| SGS-F-009 | The service must handle videos with no matches by marking them as successfully scanned with zero matches. |
| SGS-F-010 | After successful persistence, the service must emit a confirmation signal (RabbitMQ event or MongoDB state transition) indicating that cleanup is now allowed for the associated scan. |

#### 3.3.2 Idempotency Requirements

| ID | Requirement |
|---|---|
| SGS-I-001 | The service must be idempotent. If the same `scan-completed` event is delivered more than once, the service must not produce duplicate similarity edges or corrupt group state. |

#### 3.3.3 Boundary Constraints

| ID | Constraint |
|---|---|
| SGS-B-001 | The service must not invoke VDF. |
| SGS-B-002 | The service must not copy files from S3. |
| SGS-B-003 | The service must not use VDF internal state as the source of truth. All decisions must be driven from normalized scan result payloads and MongoDB state. |

---

## 4. RabbitMQ Messaging Requirements

### 4.1 New Video Ready for Scan

**Producer:** Upstream ingest pipeline  
**Consumer:** Video Scan Staging Service

#### 4.1.1 Message Schema Requirements

| ID | Requirement |
|---|---|
| MQ-NVS-001 | The message must include a globally unique event ID. |
| MQ-NVS-002 | The message must include a schema version field. |
| MQ-NVS-003 | The message must include the video ID. |
| MQ-NVS-004 | The message must include the S3 object reference (bucket and key or equivalent). |
| MQ-NVS-005 | The message must include an ISO 8601 timestamp. |
| MQ-NVS-006 | The message must include a correlation ID or trace ID for distributed tracing. |

#### 4.1.2 Delivery Requirements

| ID | Requirement |
|---|---|
| MQ-NVS-D-001 | The consumer must be capable of receiving the same message more than once and handling it idempotently (see VSS-I-001). |

---

### 4.2 Scan Completed

**Producer:** VDF Batch Scanner Service  
**Consumer:** Similarity Grouping Service

#### 4.2.1 Message Schema Requirements

| ID | Requirement |
|---|---|
| MQ-SC-001 | The message must include a globally unique event ID. |
| MQ-SC-002 | The message must include a schema version field. |
| MQ-SC-003 | The message must include the scan ID. |
| MQ-SC-004 | The message must include the durable result location (S3 bucket and key or equivalent). |
| MQ-SC-005 | The message must include the list of scanned video IDs or a stable reference to them. |
| MQ-SC-006 | The message must include the scanner profile and version used. |
| MQ-SC-007 | The message must include an ISO 8601 timestamp. |
| MQ-SC-008 | The message must include a correlation ID or trace ID. |
| MQ-SC-009 | The message must not contain a large inline scan result payload. Result data must be loaded from the durable result location. |

---

### 4.3 Scan Persisted / Grouping Completed

**Producer:** Similarity Grouping Service (or MongoDB state transition)  
**Consumer:** VDF Batch Scanner Service or cleanup process

#### 4.3.1 Signal Requirements

| ID | Requirement |
|---|---|
| MQ-SP-001 | The signal must indicate that the scan result has been successfully persisted in MongoDB and that local cleanup is now allowed. |
| MQ-SP-002 | The signal must identify the scan ID it applies to. |
| MQ-SP-003 | If implemented as a RabbitMQ message, the message must include event ID, scan ID, timestamp, and correlation ID. |
| MQ-SP-004 | If implemented as a MongoDB state transition, the transition must be observable by the cleanup process without requiring an additional RabbitMQ message. |

---

## 5. Durable Result Handoff

| ID | Requirement |
|---|---|
| DRH-001 | Normalized scan results must be written to durable S3-compatible storage before the `scan-completed` RabbitMQ event is published. |
| DRH-002 | The `scan-completed` message must reference the durable result location, not embed the payload. |
| DRH-003 | The result payload must be retrievable by the grouping service on any retry attempt. |
| DRH-004 | The result payload must remain in durable storage until the grouping service confirms successful persistence or the retention policy allows expiry. |
| DRH-005 | RabbitMQ must not be used as the storage mechanism for large scan result payloads. |

---

## 6. Durable Batch Claiming

| ID | Requirement |
|---|---|
| DBC-001 | Batch ownership must be recorded in MongoDB before a worker begins scanning. |
| DBC-002 | The system must prevent concurrent processing of the same video or scan batch by multiple worker instances. |
| DBC-003 | Each batch claim record must contain: `scan_id`, `claimed_video_ids`, `owner_id`, `claim_timestamp`, `claim_expiration_timestamp`, `status`. |
| DBC-004 | Claims past their expiration timestamp must be recoverable — another worker must be able to reclaim the batch. |
| DBC-005 | Filesystem moves must not be the only mechanism for enforcing batch ownership. |

---

## 7. Safe Cleanup / Purge

| ID | Requirement |
|---|---|
| SC-001 | Local scan files, VDF internal state, temporary exports, and scan artifacts must not be purged immediately after the `scan-completed` event is published. |
| SC-002 | Cleanup is allowed only after condition (a): the Similarity Grouping Service has confirmed successful persistence; or condition (b): a configured retention period has expired and the scan is recorded as safely expired or unrecoverable. |
| SC-003 | The system must track one of the following cleanup states per scan: `pending_cleanup`, `cleanup_allowed`, `cleaned`, `cleanup_failed`. |
| SC-004 | The system must retain sufficient state to allow grouping to be retried before cleanup occurs. |
| SC-005 | Transition from `cleanup_allowed` to `cleaned` must only occur after a cleanup process verifies and removes local artifacts. |
| SC-006 | A failed cleanup attempt must result in `cleanup_failed` state and must not silently discard the error. |

---

## 8. Similarity Threshold Policy

| ID | Requirement |
|---|---|
| STP-001 | The system must support a configurable threshold for storing similarity edges. Edges below this threshold must not be stored. |
| STP-002 | The system must support a configurable threshold for automatically merging videos into similarity groups. Videos below this threshold must not be auto-merged. |
| STP-003 | The edge-storage threshold may be set lower than the group-merge threshold. |
| STP-004 | The system must support a strong-duplicate threshold above which videos are considered definite duplicates. |
| STP-005 | The system must support a manual-review threshold below which videos flagged for grouping are held for human review rather than auto-merged. |
| STP-006 | All threshold values must be configurable without code changes. |

**Example policy configuration:**

```yaml
similarityPolicy:
  storeEdgeScore: 0.88
  autoMergeGroupScore: 0.93
  strongDuplicateScore: 0.98
  requireManualReviewBelow: 0.93
```

---

## 9. Scan Status State Machine

Each video must track a scan status in MongoDB. The following states and transitions are required:

| State | Description |
|---|---|
| `awaiting_staging` | Video is ingested; staging not yet started. |
| `staged` | Video file materialized to scan path; ready for batch claim. |
| `claimed` | Video is part of an active batch claim. |
| `scanning` | VDF is actively scanning this video. |
| `scan_complete` | VDF scan finished; normalized results written to durable storage. |
| `grouping_complete` | Similarity edges and group membership persisted in MongoDB. |
| `pending_cleanup` | Grouping confirmed; awaiting cleanup authorization. |
| `cleanup_allowed` | Cleanup may now proceed. |
| `cleaned` | Local scan artifacts removed. |
| `failed` | A non-recoverable error occurred; manual intervention required. |

Valid transitions must be enforced. A video must not move backward through states except under an explicit retry or revision policy.

---

## 10. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 | All three services must be independently deployable NestJS applications. |
| NFR-002 | All inter-service communication must use RabbitMQ. Direct service-to-service HTTP calls for the core pipeline flow are not permitted. |
| NFR-003 | All MongoDB write operations that affect scan state or group membership must be performed with appropriate write concerns to prevent silent data loss. |
| NFR-004 | The system must log structured errors with sufficient context (video ID, scan ID, correlation ID) to support production debugging. |
| NFR-005 | Each service must expose a health check endpoint. |
| NFR-006 | The system must tolerate temporary unavailability of RabbitMQ or MongoDB by queuing or retrying operations rather than failing permanently. |
