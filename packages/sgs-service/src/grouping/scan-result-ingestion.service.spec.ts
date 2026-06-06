import { ScanCompletedEvent, ScanState } from '@vdf/shared-types';
import { ScanResultIngestionService } from './scan-result-ingestion.service';
import { ScanResultSchemaValidator } from './scan-result-schema.validator';
import { SimilarityEdgeFactory } from './similarity-edge.factory';
import { GroupMergePolicy } from './group-merge.policy';

const makeEvent = (): ScanCompletedEvent => ({
  scan_id: 'scan-001',
  result_location: 'scan-results/scan-001.json',
  scanned_video_ids: ['vid-001'],
  scanner_profile: 'default',
  scanner_version: '2.0',
  timestamp: new Date().toISOString(),
  correlation_id: 'vid-001',
});

describe('ScanResultIngestionService', () => {
  let service: ScanResultIngestionService;
  let config: jest.Mocked<any>;
  let s3Loader: jest.Mocked<any>;
  let edgeRepo: jest.Mocked<any>;
  let groupRepo: jest.Mocked<any>;
  let completionWriter: jest.Mocked<any>;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        const vals: Record<string, number> = {
          STORE_EDGE_SCORE_THRESHOLD: 0.6,
          AUTO_MERGE_GROUP_SCORE: 0.9,
          REQUIRE_MANUAL_REVIEW_BELOW: 0.75,
          MIN_SIMILARITY_SCORE: 0.5,
        };
        return vals[key];
      }),
    };
    s3Loader = { load: jest.fn() };
    edgeRepo = { findByScanId: jest.fn(), upsertEdge: jest.fn() };
    groupRepo = { findByVideoId: jest.fn(), createGroup: jest.fn(), mergeIntoGroup: jest.fn() };
    completionWriter = { markGroupingComplete: jest.fn() };

    service = new ScanResultIngestionService(
      config,
      new ScanResultSchemaValidator(),
      new SimilarityEdgeFactory(),
      new GroupMergePolicy(),
      s3Loader,
      edgeRepo,
      groupRepo,
      completionWriter,
    );
  });

  it('skips ingestion when scan already ingested (edges exist)', async () => {
    edgeRepo.findByScanId.mockResolvedValue([{ scan_id: 'scan-001' }]);

    const result = await service.ingest(makeEvent());

    expect(result).toBe('already_ingested');
    expect(s3Loader.load).not.toHaveBeenCalled();
  });

  it('processes normally when scan is new (no existing edges)', async () => {
    edgeRepo.findByScanId.mockResolvedValue([]);
    s3Loader.load.mockResolvedValue({
      scan_id: 'scan-001',
      schema_version: '1.0',
      scanner_version: '2.0',
      video_pairs: [{ video_id_a: 'v1', video_id_b: 'v2', similarity_score: 0.95 }],
    });
    edgeRepo.upsertEdge.mockResolvedValue(undefined);
    groupRepo.findByVideoId.mockResolvedValue(null);
    groupRepo.createGroup.mockResolvedValue('grp-001');
    completionWriter.markGroupingComplete.mockResolvedValue(undefined);

    const result = await service.ingest(makeEvent());

    expect(result).toBe('ingested');
    expect(edgeRepo.upsertEdge).toHaveBeenCalled();
    expect(completionWriter.markGroupingComplete).toHaveBeenCalledWith(['vid-001']);
  });
});
