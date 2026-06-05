/**
 * TC-CHAR-025: Assert VDF error classes are preserved
 * PB-005: Error boundary types
 */
import {
  VdfTimeoutError,
  VdfProcessError,
  VdfOutputMissingError,
} from '../../src/scanning/infrastructure/vdf-runner.adapter';

describe('VdfTimeoutError (TC-CHAR-025)', () => {
  it('instanceof VdfTimeoutError === true', () => {
    const err = new VdfTimeoutError('s1', 5000);
    expect(err instanceof VdfTimeoutError).toBe(true);
  });

  it("error.name === 'VdfTimeoutError'", () => {
    const err = new VdfTimeoutError('s1', 5000);
    expect(err.name).toBe('VdfTimeoutError');
  });

  it('error.message includes timeout info', () => {
    const err = new VdfTimeoutError('s1', 5000);
    expect(err.message).toContain('5000');
    expect(err.message).toContain('s1');
  });
});

describe('VdfProcessError (TC-CHAR-025)', () => {
  it('instanceof VdfProcessError === true', () => {
    const err = new VdfProcessError('s1', -1, 'stderr output');
    expect(err instanceof VdfProcessError).toBe(true);
  });

  it("error.name === 'VdfProcessError'", () => {
    const err = new VdfProcessError('s1', -1, 'stderr output');
    expect(err.name).toBe('VdfProcessError');
  });

  it('error.message includes exit code and scanId', () => {
    const err = new VdfProcessError('s1', -1, 'stderr output');
    expect(err.message).toContain('-1');
    expect(err.message).toContain('s1');
  });
});

describe('VdfOutputMissingError (TC-CHAR-025)', () => {
  it('instanceof VdfOutputMissingError === true', () => {
    const err = new VdfOutputMissingError('s1', '/path/to/output.json');
    expect(err instanceof VdfOutputMissingError).toBe(true);
  });

  it("error.name === 'VdfOutputMissingError'", () => {
    const err = new VdfOutputMissingError('s1', '/path/to/output.json');
    expect(err.name).toBe('VdfOutputMissingError');
  });

  it('error.message includes expected path', () => {
    const err = new VdfOutputMissingError('s1', '/path/to/output.json');
    expect(err.message).toContain('/path/to/output.json');
    expect(err.message).toContain('s1');
  });
});
