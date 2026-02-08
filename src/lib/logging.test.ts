import { describe, it, expect, vi } from 'vitest';
import { Logger } from './logging.js';

describe('Logger', () => {
  function createTestLogger(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
    const lines: string[] = [];
    const logger = new Logger({
      level,
      output: (line) => lines.push(line),
    });
    return { logger, lines };
  }

  it('outputs valid JSON lines', () => {
    const { logger, lines } = createTestLogger();
    logger.info('test message');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toBeDefined();
  });

  it('includes required fields: timestamp, level, message', () => {
    const { logger, lines } = createTestLogger();
    logger.info('hello');
    const entry = JSON.parse(lines[0]);
    expect(entry.timestamp).toBeDefined();
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello');
    // Verify timestamp is ISO format
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  it('includes optional fields when provided', () => {
    const { logger, lines } = createTestLogger();
    logger.info('sandbox started', {
      component: 'runtime',
      sandbox: 'my-sb',
      requestId: 'req-123',
      event: 'sandbox.start',
    });
    const entry = JSON.parse(lines[0]);
    expect(entry.component).toBe('runtime');
    expect(entry.sandbox).toBe('my-sb');
    expect(entry.requestId).toBe('req-123');
    expect(entry.event).toBe('sandbox.start');
  });

  it('serializes Error objects to message string', () => {
    const { logger, lines } = createTestLogger();
    logger.error('something failed', {
      error: new Error('disk full'),
    });
    const entry = JSON.parse(lines[0]);
    expect(entry.error).toBe('disk full');
  });

  it('includes string error field as-is', () => {
    const { logger, lines } = createTestLogger();
    logger.error('oops', { error: 'string error' });
    const entry = JSON.parse(lines[0]);
    expect(entry.error).toBe('string error');
  });

  it('respects log level filtering', () => {
    const { logger, lines } = createTestLogger('warn');
    logger.debug('skip');
    logger.info('skip');
    logger.warn('keep');
    logger.error('keep');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).level).toBe('warn');
    expect(JSON.parse(lines[1]).level).toBe('error');
  });

  it('supports all four log levels', () => {
    const { logger, lines } = createTestLogger('debug');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]).level).toBe('debug');
    expect(JSON.parse(lines[1]).level).toBe('info');
    expect(JSON.parse(lines[2]).level).toBe('warn');
    expect(JSON.parse(lines[3]).level).toBe('error');
  });

  it('omits undefined fields', () => {
    const { logger, lines } = createTestLogger();
    logger.info('clean', { component: 'test', sandbox: undefined });
    const entry = JSON.parse(lines[0]);
    expect(entry.component).toBe('test');
    expect('sandbox' in entry).toBe(false);
  });

  it('setLevel changes minimum level', () => {
    const { logger, lines } = createTestLogger('debug');
    logger.debug('visible');
    logger.setLevel('error');
    logger.debug('hidden');
    logger.info('hidden');
    logger.error('visible');
    expect(lines).toHaveLength(2);
  });
});
