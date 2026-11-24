import { describe, expect, it } from 'vitest';
import { interpolate, portsOpened, variableInPorts, variablesIn } from './composePorts';

describe('portsOpened', () => {
  it.each([
    ['3001', { hostIp: '', containerPorts: [3001] }],
    ['3001:3001', { hostIp: '', containerPorts: [3001] }],
    ['8080:3001', { hostIp: '', containerPorts: [3001] }],
    ['127.0.0.1:8428:8428', { hostIp: '127.0.0.1', containerPorts: [8428] }],
    ['127.0.0.1::8880', { hostIp: '127.0.0.1', containerPorts: [8880] }],
    ['[::1]:3002:3002', { hostIp: '::1', containerPorts: [3002] }],
    ['::1:3002:3002', { hostIp: '::1', containerPorts: [3002] }],
    ['8000-8002:8000-8002', { hostIp: '', containerPorts: [8000, 8001, 8002] }],
    ['3002:3002/udp', { hostIp: '', containerPorts: [3002] }],
    ['127.0.0.1:3002:3002/tcp', { hostIp: '127.0.0.1', containerPorts: [3002] }],
  ])('reads the short form %s', (entry, opened) => {
    expect(portsOpened(entry)).toEqual(opened);
  });

  it('reads a number', () => {
    expect(portsOpened(8428)).toEqual({ hostIp: '', containerPorts: [8428] });
  });

  it('reads the long form, also with no published port (Docker then picks a host port)', () => {
    expect(portsOpened({ target: 8428 })).toEqual({ hostIp: '', containerPorts: [8428] });
    expect(portsOpened({ target: 3002, published: '3002', host_ip: '127.0.0.1' })).toEqual({ hostIp: '127.0.0.1', containerPorts: [3002] });
    expect(portsOpened({ target: '8000-8001', published: '9000-9001' })).toEqual({ hostIp: '', containerPorts: [8000, 8001] });
  });

  describe('with a variable', () => {
    const bindAddress = '${ADDRESS:-}${ADDRESS:+:}3001:3001';

    it('reads no host address when the variable is not set or empty, so Docker opens all IPv4 and IPv6 addresses', () => {
      expect(portsOpened(bindAddress)).toEqual({ hostIp: '', containerPorts: [3001] });
      expect(portsOpened(bindAddress, { ADDRESS: '' })).toEqual({ hostIp: '', containerPorts: [3001] });
    });

    it.each([
      ['192.168.10.5', '192.168.10.5'],
      ['127.0.0.1', '127.0.0.1'],
      ['[::1]', '::1'],
      ['[fd00::5]', 'fd00::5'],
    ])('reads the host address %s from the variable', (address, hostIp) => {
      expect(portsOpened(bindAddress, { ADDRESS: address })).toEqual({ hostIp, containerPorts: [3001] });
    });

    // A value with ":" or "/" can look like more ports. Docker Compose takes all the parts before the last two as the
    // host address, and refuses each of these values with "invalid IP address" (checked with
    // "docker compose config", Compose v2.40.3). So none of them opens a port. The test still reads the container port
    // from the last part, as Compose does, so it sees the same ports.
    it.each([
      '0.0.0.0:8428:8428',
      '0.0.0.0:3002:3002/udp',
      '1.2.3.4/udp',
      '0.0.0.0/0',
      '127.0.0.1:3002:3002,8428',
      'a b',
      '1.2.3.4\n8428',
      '[::1]:3002',
      'localhost',
    ])('reads only the container port 3001 when the variable is %j', address => {
      expect(portsOpened(bindAddress, { ADDRESS: address }).containerPorts).toEqual([3001]);
    });

    it('takes the protocol off the last part only, as Docker Compose does', () => {
      expect(portsOpened('${A:-}${A:+:}3002:3002', { A: '1.2.3.4/udp' })).toEqual({ hostIp: '1.2.3.4/udp', containerPorts: [3002] });
      expect(portsOpened('${A:-}${A:+:}3001:3001/tcp', { A: '0.0.0.0:3002:3002/udp' })).toEqual({
        hostIp: '0.0.0.0:3002:3002/udp',
        containerPorts: [3001],
      });
    });

    it('reads a variable in the container port, so that a test sees each port that the entry can open', () => {
      expect(portsOpened('${PORT:-3002}:${PORT:-3002}')).toEqual({ hostIp: '', containerPorts: [3002] });
      expect(portsOpened('${PORT:-3002}:${PORT:-3002}', { PORT: '8428' })).toEqual({ hostIp: '', containerPorts: [8428] });
    });

    it('reads a variable in the long form', () => {
      expect(portsOpened({ target: '${PORT:-3002}', host_ip: '${ADDRESS:-127.0.0.1}' })).toEqual({
        hostIp: '127.0.0.1',
        containerPorts: [3002],
      });
      expect(portsOpened({ target: 3001, host_ip: '${ADDRESS}' }, { ADDRESS: '0.0.0.0' })).toEqual({
        hostIp: '0.0.0.0',
        containerPorts: [3001],
      });
    });
  });
});

describe('variableInPorts', () => {
  // A variable may set only the host address. The host port and the container port (the last two ":" parts,
  // with the protocol) must be plain text in the file, for each value of each variable.
  it.each([
    '3001:3001',
    '${A:-}${A:+:}3001:3001',
    '${ADDRESS:-127.0.0.1}:3002:3002',
    '${ADDRESS}:3001:3001/tcp',
    '[${ADDRESS:-::1}]:3002:3002',
  ])('finds no variable in the ports of %s', entry => {
    expect(variableInPorts(entry)).toBe(false);
  });

  it.each([
    '${A:-127.0.0.1}:${B:-3001}:3001',
    '${PORT:-3002}:${PORT:-3002}',
    '${A:-127.0.0.1}:3001:${B:-3001}',
    '${A}3001:3001',
    '${A-127.0.0.1:}3001:3001',
    '${A:-}${A:+:}3001:3001/${P:-tcp}',
  ])('finds a variable in the ports of %s', entry => {
    expect(variableInPorts(entry)).toBe(true);
  });

  it('reads the long form: a variable may be only in host_ip', () => {
    expect(variableInPorts({ target: 3001, host_ip: '${ADDRESS}' })).toBe(false);
    expect(variableInPorts({ target: '${PORT:-3002}', host_ip: '127.0.0.1' })).toBe(true);
    expect(variableInPorts({ target: 3002, published: '${PORT}' })).toBe(true);
    expect(variableInPorts({ target: 3002, protocol: '${P}' })).toBe(true);
  });

  it('finds no variable in a number', () => {
    expect(variableInPorts(3001)).toBe(false);
  });
});

describe('interpolate', () => {
  // The rules of Docker Compose: https://docs.docker.com/reference/compose-file/interpolation/
  // Each row was checked with "docker compose config" (Compose v2.40.3), with the variable not set, empty and set.
  it.each([
    ['${A}', {}, ''],
    ['${A}', { A: 'x' }, 'x'],
    ['$A:1', { A: 'x' }, 'x:1'],
    ['${A:-d}', {}, 'd'],
    ['${A:-d}', { A: '' }, 'd'],
    ['${A:-d}', { A: 'x' }, 'x'],
    ['${A-d}', {}, 'd'],
    ['${A-d}', { A: '' }, ''],
    ['${A-d}', { A: 'x' }, 'x'],
    ['${A:+r}', {}, ''],
    ['${A:+r}', { A: '' }, ''],
    ['${A:+r}', { A: 'x' }, 'r'],
    ['${A+r}', {}, ''],
    ['${A+r}', { A: '' }, 'r'],
    ['${A+r}', { A: 'x' }, 'r'],
    ['${A:-}${A:+:}3001', {}, '3001'],
    ['${A:-}${A:+:}3001', { A: '' }, '3001'],
    ['${A:-}${A:+:}3001', { A: 'x' }, 'x:3001'],
    ['$$A', { A: 'x' }, '$A'],
    ['no variable', {}, 'no variable'],
  ])('makes %s with %j into "%s"', (text, environment, expected) => {
    expect(interpolate(text, environment)).toBe(expected);
  });

  it.each(['${A:?must be set}', '${A?must be set}', '${A:-${B}}', '${A', '${}', '$'])(
    'stops at %s, because the test cannot be sure what Docker Compose then does',
    text => {
      expect(() => interpolate(text, {})).toThrow(/cannot read/);
    },
  );
});

describe('variablesIn', () => {
  it('names each variable one time', () => {
    expect(variablesIn('${A:-}${A:+:}${B}:$C:$$D')).toEqual(['A', 'B', 'C']);
  });

  it('finds no variable in a plain port', () => {
    expect(variablesIn('3001:3001')).toEqual([]);
  });
});
