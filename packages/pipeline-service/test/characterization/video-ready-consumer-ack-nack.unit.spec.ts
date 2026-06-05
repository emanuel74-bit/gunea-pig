/**
 * TC-CHAR-026: Assert VideoReadyConsumer ack/nack behavior at all error boundaries
 * PB-005: Error boundary types
 */
import { VideoReadyConsumer } from '../../src/staging/transport/video-ready.consumer';
import {
  StageVideoHandler,
  VideoAlreadyStagedError,
  StagingPermanentFailureError,
} from '../../src/staging/application/stage-video.handler';
import { StagingMessageValidationError } from '../../src/staging/transport/staging-message.validator';
import { S3ObjectNotFoundError } from '../../src/staging/infrastructure/file-staging.adapter';

const validPayload = {
  schemaVersion: '1.0' as const,
  eventId: 'e1',
  videoId: 'v1',
  s3ObjectKey: 'key/file.mp4',
  s3Bucket: 'my-bucket',
  timestamp: new Date().toISOString(),
  correlationId: 'c1',
};

function buildContext(msg: unknown = {}) {
  const ack = jest.fn();
  const nack = jest.fn();
  const channel = { ack, nack };
  const context = {
    getChannelRef: () => channel,
    getMessage: () => msg,
  };
  return { context, ack, nack };
}

describe('VideoReadyConsumer ack/nack contract (TC-CHAR-026)', () => {
  let consumer: VideoReadyConsumer;
  let mockHandler: jest.Mocked<StageVideoHandler>;

  beforeEach(() => {
    mockHandler = {
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StageVideoHandler>;
    consumer = new VideoReadyConsumer(mockHandler);
  });

  it('invalid payload (StagingMessageValidationError) -> channel.nack(msg, false, false); ack never called', async () => {
    const { context, ack, nack } = buildContext();
    const invalidPayload = { schemaVersion: '99.0', eventId: 'e1', videoId: 'v1', s3ObjectKey: 'k', s3Bucket: 'b', timestamp: new Date().toISOString(), correlationId: 'c' };
    await consumer.handle(invalidPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(ack).not.toHaveBeenCalled();
  });

  it('successful handling -> channel.ack(msg) called; nack never called', async () => {
    const { context, ack, nack } = buildContext();
    await consumer.handle(validPayload, context as any);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('VideoAlreadyStagedError -> channel.ack(msg) called (idempotent success)', async () => {
    const { context, ack, nack } = buildContext();
    mockHandler.handle.mockRejectedValue(new VideoAlreadyStagedError('v1'));
    await consumer.handle(validPayload, context as any);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('StagingPermanentFailureError -> channel.nack(msg, false, false) called', async () => {
    const { context, ack, nack } = buildContext();
    const causeErr = new S3ObjectNotFoundError('bucket', 'key');
    mockHandler.handle.mockRejectedValue(new StagingPermanentFailureError('v1', causeErr));
    await consumer.handle(validPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(ack).not.toHaveBeenCalled();
  });

  it('Generic Error from handler -> channel.nack(msg, false, false) called', async () => {
    const { context, ack, nack } = buildContext();
    mockHandler.handle.mockRejectedValue(new Error('unexpected error'));
    await consumer.handle(validPayload, context as any);
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(ack).not.toHaveBeenCalled();
  });
});
