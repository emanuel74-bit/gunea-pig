import { Inject, Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
    ScanBatchDocument,
    ScanBatchStatus,
    QUEUE_EXCHANGES,
    ROUTING_KEYS,
    ScanCompletedEvent,
} from "@gunea-pig/shared";
import { VdfManifestNormalizer } from "../infrastructure/vdf-manifest.normalizer";
import { ScanPurgerService } from "../infrastructure/scan-purger.service";
import { PipelineConfig } from "../../config";
import { PIPELINE_CONFIG } from "../../injection-tokens";
import {
    IBatchClaimerPort,
    I_BATCH_CLAIMER,
} from "../interfaces/i-batch-claimer.port";
import { IVdfRunnerPort, I_VDF_RUNNER } from "../interfaces/i-vdf-runner.port";
import {
    IVideoScanRepository,
    I_VIDEO_SCAN_REPOSITORY,
} from "../interfaces/i-video-scan-repository.port";
import {
    IStoragePort,
    I_STORAGE,
} from "../../shared-infra/interfaces/i-storage.port";
import {
    IEventPublisher,
    I_EVENT_PUBLISHER,
} from "../../shared-infra/interfaces/i-event-publisher.port";

@Injectable()
export class ScanOrchestrator {
    private readonly logger = new Logger(ScanOrchestrator.name);
    private isRunning = false;

    constructor(
        @Inject(I_BATCH_CLAIMER)
        private readonly batchClaimer: IBatchClaimerPort,
        @Inject(I_VDF_RUNNER) private readonly vdfRunner: IVdfRunnerPort,
        private readonly purger: ScanPurgerService,
        private readonly manifestNormalizer: VdfManifestNormalizer,
        @Inject(I_VIDEO_SCAN_REPOSITORY)
        private readonly videoScanRepository: IVideoScanRepository,
        @Inject(I_STORAGE) private readonly s3: IStoragePort,
        @Inject(I_EVENT_PUBLISHER) private readonly publisher: IEventPublisher,
        @Inject(PIPELINE_CONFIG)
        private readonly config: PipelineConfig,
    ) {}

    async runScanCycle(): Promise<void> {
        if (this.isRunning) {
            this.logger.debug("Scan cycle already running — skipping tick");
            return;
        }
        this.isRunning = true;
        try {
            await this.processPendingBatch();
            await this.purger.runCleanupPass(
                this.config.vdf.resultRetentionSeconds,
            );
        } finally {
            this.isRunning = false;
        }
    }

    private async processPendingBatch(): Promise<void> {
        const batch = await this.batchClaimer.claimNextBatch(
            this.config.vdf.batchSize,
            this.config.ownerId,
            this.config.vdf.batchClaimTtlSeconds,
        );

        if (!batch) {
            this.logger.debug("No staged videos available");
            return;
        }

        const { scanId, videoIds } = batch;

        await this.batchClaimer.transitionBatchStatus(
            scanId,
            ScanBatchStatus.CLAIMED,
            ScanBatchStatus.SCANNING,
        );

        const videoIdMap =
            await this.videoScanRepository.buildVideoIdMap(videoIds);

        const outputDir = path.join(
            this.config.staging.scanPath,
            ".vdf-output",
        );

        let vdfOutputPath: string;
        try {
            const result = await this.vdfRunner.run({
                cliPath: this.config.vdf.cliPath,
                scanPath: this.config.staging.scanPath,
                outputDir,
                scanId,
                timeoutMs: this.config.vdf.batchClaimTtlSeconds * 1_000 * 0.8,
            });
            vdfOutputPath = result.outputPath;
        } catch (err) {
            const error = err as Error;
            this.logger.error(
                { scanId, err: error.message },
                "VDF scan failed",
            );
            await this.batchClaimer.transitionBatchStatus(
                scanId,
                ScanBatchStatus.SCANNING,
                ScanBatchStatus.FAILED,
                { failReason: error.message } as Partial<ScanBatchDocument>,
            );
            await this.videoScanRepository.markScanFailed(videoIds);
            return;
        }

        const normalized = this.manifestNormalizer.normalize(
            scanId,
            vdfOutputPath,
            videoIdMap,
            this.config.vdf.scannerVersion,
            this.config.vdf.scannerProfile,
        );

        const resultS3Key = `scans/${scanId}/result.json`;
        await this.s3.putJson(
            { bucket: this.config.s3.bucketScanResults, key: resultS3Key },
            normalized,
        );

        await this.batchClaimer.transitionBatchStatus(
            scanId,
            ScanBatchStatus.SCANNING,
            ScanBatchStatus.SCAN_EXPORTED,
            {
                resultS3Key,
                resultS3Bucket: this.config.s3.bucketScanResults,
            } as Partial<ScanBatchDocument>,
        );

        await this.videoScanRepository.markScanCompleted(videoIds, scanId);

        await this.batchClaimer.transitionBatchStatus(
            scanId,
            ScanBatchStatus.SCAN_EXPORTED,
            ScanBatchStatus.PENDING_GROUPING,
        );

        const correlationId = uuidv4();
        const event: ScanCompletedEvent = {
            eventId: uuidv4(),
            schemaVersion: "1.0",
            scanId,
            resultS3Key,
            resultS3Bucket: this.config.s3.bucketScanResults,
            videoIds,
            scannerVersion: this.config.vdf.scannerVersion,
            scannerProfile: this.config.vdf.scannerProfile,
            timestamp: new Date().toISOString(),
            correlationId,
        };

        await this.publisher.publish({
            exchange: QUEUE_EXCHANGES.SCAN_EVENTS,
            routingKey: ROUTING_KEYS.SCAN_COMPLETED,
            payload: event as unknown as Record<string, unknown>,
            correlationId,
        });

        this.logger.log(
            { scanId, videoCount: videoIds.length, resultS3Key },
            "Scan completed and published",
        );
    }
}
