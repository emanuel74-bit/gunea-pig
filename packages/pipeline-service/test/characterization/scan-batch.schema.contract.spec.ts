/**
 * TC-CHAR-008: Assert ScanBatchDocument @Schema collection name equals 'scan_batches'
 * PB-002: Mongoose collection definitions
 */
import 'reflect-metadata';
import { ScanBatchDocument, ScanBatchSchema } from '@gunea-pig/shared';

describe('ScanBatchDocument @Schema collection contract (TC-CHAR-008)', () => {
  it("ScanBatchDocument @Schema collection option equals 'scan_batches'", () => {
    const schemaMetadata = Reflect.getMetadata('mongoose:schema_options', ScanBatchDocument);
    expect(schemaMetadata?.collection).toBe('scan_batches');
  });

  it("ScanBatchSchema path for 'scanId' is required and unique", () => {
    const scanIdPath = ScanBatchSchema.path('scanId');
    expect(scanIdPath).toBeDefined();
    expect((scanIdPath as any).options.required).toBeTruthy();
    expect((scanIdPath as any).options.unique).toBeTruthy();
  });

  it("ScanBatchSchema path for 'status' is required enum", () => {
    const statusPath = ScanBatchSchema.path('status');
    expect(statusPath).toBeDefined();
    expect((statusPath as any).options.required).toBeTruthy();
  });

  it("ScanBatchSchema path for 'videoIds' is required array", () => {
    const videoIdsPath = ScanBatchSchema.path('videoIds');
    expect(videoIdsPath).toBeDefined();
    expect((videoIdsPath as any).options.required).toBeTruthy();
  });

  it("ScanBatchSchema path for 'ownerId' is required", () => {
    const ownerIdPath = ScanBatchSchema.path('ownerId');
    expect(ownerIdPath).toBeDefined();
    expect((ownerIdPath as any).options.required).toBeTruthy();
  });

  it("ScanBatchSchema path for 'claimedAt' is required", () => {
    const claimedAtPath = ScanBatchSchema.path('claimedAt');
    expect(claimedAtPath).toBeDefined();
    expect((claimedAtPath as any).options.required).toBeTruthy();
  });

  it("ScanBatchSchema path for 'expiresAt' is required", () => {
    const expiresAtPath = ScanBatchSchema.path('expiresAt');
    expect(expiresAtPath).toBeDefined();
    expect((expiresAtPath as any).options.required).toBeTruthy();
  });

  it("ScanBatchSchema path for 'retryCount' has default 0", () => {
    const retryCountPath = ScanBatchSchema.path('retryCount');
    expect(retryCountPath).toBeDefined();
    expect((retryCountPath as any).defaultValue).toBe(0);
  });
});
