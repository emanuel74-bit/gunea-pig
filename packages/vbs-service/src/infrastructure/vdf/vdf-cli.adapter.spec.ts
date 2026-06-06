import { ConfigService } from '@nestjs/config';
import { VdfCliAdapter, VdfExecutionError } from './vdf-cli.adapter';
import { EventEmitter } from 'events';

jest.mock('child_process');

import * as cp from 'child_process';

function makeChildMock(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe('VdfCliAdapter', () => {
  let adapter: VdfCliAdapter;
  const spawnMock = cp.spawn as jest.MockedFunction<typeof cp.spawn>;

  beforeEach(() => {
    const config = { get: () => '/usr/local/bin/vdf' } as unknown as ConfigService;
    adapter = new VdfCliAdapter(config);
  });

  afterEach(() => jest.resetAllMocks());

  it('spawns VDF process with correct arguments', async () => {
    const child = makeChildMock();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof cp.spawn>);

    const promise = adapter.scan('/tmp/videos');
    child.stdout.emit('data', Buffer.from('{"pairs":[]}'));
    child.emit('close', 0);

    await promise;
    expect(spawnMock).toHaveBeenCalledWith('/usr/local/bin/vdf', [
      '--scan',
      '/tmp/videos',
      '--output',
      'json',
    ]);
  });

  it('returns raw output string on VDF exit code 0', async () => {
    const child = makeChildMock();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof cp.spawn>);

    const promise = adapter.scan('/tmp/videos');
    child.stdout.emit('data', Buffer.from('{"pairs":[]}'));
    child.emit('close', 0);

    const result = await promise;
    expect(result).toBe('{"pairs":[]}');
  });

  it('throws retryable VdfExecutionError on VDF exit code != 0', async () => {
    const child = makeChildMock();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof cp.spawn>);

    const promise = adapter.scan('/tmp/videos');
    child.stderr.emit('data', Buffer.from('scan failed'));
    child.emit('close', 1);

    await expect(promise).rejects.toThrow(VdfExecutionError);
    await expect(promise).rejects.toMatchObject({ is_retryable: true });
  });

  it('classifies ENOENT spawn error as is_retryable=false', async () => {
    const child = makeChildMock();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof cp.spawn>);

    const promise = adapter.scan('/tmp/videos');
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    child.emit('error', err);

    await expect(promise).rejects.toMatchObject({ is_retryable: false });
  });
});
