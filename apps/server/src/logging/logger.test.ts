import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureLogging, createLogger, logFormatFrom, logLevelFrom, type LogLevel } from './logger.js';

const TIME = new Date('2026-11-12T10:00:00.000Z');

describe('createLogger', () => {
  let written: { level: LogLevel; text: string }[];
  let restore: () => void;

  function use(level: LogLevel, format: 'text' | 'json' = 'text') {
    const old = configureLogging({ level, format, now: () => TIME, sink: (lineLevel, text) => written.push({ level: lineLevel, text }) });
    restore = () => configureLogging(old);
  }

  beforeEach(() => {
    written = [];
  });

  afterEach(() => restore());

  it('writes the time, level, part of the server, message and details', () => {
    use('info');
    createLogger('poller').warn('Machine went offline', { machine: 'm1', reason: 'Connection refused' });
    expect(written).toEqual([{
      level: 'warn',
      text: '2026-11-12T10:00:00.000Z WARN  [poller] Machine went offline machine=m1 reason="Connection refused"',
    }]);
  });

  it('leaves out the lines below the level', () => {
    use('warn');
    const log = createLogger('x');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(written.map(line => line.level)).toEqual(['warn', 'error']);
  });

  it('writes debug lines at the debug level', () => {
    use('debug');
    createLogger('x').debug('d');
    expect(written).toHaveLength(1);
  });

  it('adds the details of a child logger to each line', () => {
    use('info');
    createLogger('machines', { type: 'siemens' }).child({ machine: 'm1' }).info('Machine connected', { host: '10.0.0.5' });
    expect(written[0].text).toContain('type=siemens machine=m1 host=10.0.0.5');
  });

  it('leaves out details that are undefined, and quotes text with spaces, quotes or equals signs', () => {
    use('info');
    createLogger('x').info('m', { a: undefined, b: 'two words', c: 'a=b', d: '', e: 5, f: [1, 2] });
    expect(written[0].text).toMatch(/ m b="two words" c="a=b" d="" e=5 f=\[1,2\]$/);
  });

  it('keeps a message with a line break on one line', () => {
    use('info');
    createLogger('x').warn('m', { reason: 'line one\nline two' });
    expect(written[0].text.split('\n')).toHaveLength(1);
  });

  it('writes the message of an error, and its stack only on an error line', () => {
    use('info');
    const error = new Error('disk full');
    createLogger('x').warn('Could not save', { error });
    createLogger('x').error('Could not save', { error });
    expect(written[0].text).toMatch(/error="disk full"$/);
    expect(written[1].text.split('\n').length).toBeGreaterThan(1);
    expect(written[1].text.split('\n')[1]).toMatch(/^\s+at /);
  });

  it('writes the stack of each error at the debug level', () => {
    use('debug');
    createLogger('x').warn('Could not save', { error: new Error('disk full') });
    expect(written[0].text.split('\n').length).toBeGreaterThan(1);
  });

  it('writes one JSON object for each line in the JSON format', () => {
    use('info', 'json');
    createLogger('poller').error('Could not load', { machine: 'm1', error: new Error('bad row') });
    const line = JSON.parse(written[0].text);
    expect(line).toMatchObject({ time: '2026-11-12T10:00:00.000Z', level: 'error', component: 'poller', msg: 'Could not load', machine: 'm1' });
    expect(line.error.message).toBe('bad row');
    expect(line.error.stack).toContain('bad row');
  });
});

describe('logLevelFrom and logFormatFrom', () => {
  it('reads the level, in any case, and uses info for anything else', () => {
    expect(logLevelFrom('DEBUG')).toBe('debug');
    expect(logLevelFrom(' warn ')).toBe('warn');
    expect(logLevelFrom('verbose')).toBe('info');
    expect(logLevelFrom(undefined)).toBe('info');
  });

  it('uses JSON only when asked', () => {
    expect(logFormatFrom('json')).toBe('json');
    expect(logFormatFrom('JSON')).toBe('json');
    expect(logFormatFrom('pretty')).toBe('text');
    expect(logFormatFrom(undefined)).toBe('text');
  });
});
