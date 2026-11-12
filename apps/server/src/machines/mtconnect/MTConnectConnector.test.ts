import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MTConnectConnector } from './MTConnectConnector.js';
import type { MTConnectMachineConfig } from '../../types/index.js';

function newConnector(config: Partial<MTConnectMachineConfig> = {}): MTConnectConnector {
  return new MTConnectConnector({ name: 'Test', host: '192.168.1.100', ...config });
}

/** Make the connector get these replies instead of calling a real agent, and give the spy */
function serveReplies(reply: (url: string) => string) {
  return vi.spyOn(MTConnectConnector.prototype as unknown as { httpGet: (url: string) => Promise<string> }, 'httpGet')
    .mockImplementation(async (url: string) => reply(url));
}

const PROBE = `<MTConnectDevices><Devices><Device id="d1" name="M1" uuid="u1"><DataItems>
  <DataItem id="mode" type="CONTROLLER_MODE" category="EVENT"/>
</DataItems></Device></Devices></MTConnectDevices>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MTConnectConnector', () => {
  let connector: MTConnectConnector;

  beforeEach(() => {
    connector = newConnector({ id: 'test_mtconnect', name: 'TestMTConnect', mtConnectPort: 5000, timeout: 5000 });
  });

  afterEach(() => {
    connector.disconnect();
  });

  describe('constructor', () => {
    it('should initialize with provided values', () => {
      expect(connector.id).toBe('test_mtconnect');
      expect(connector.name).toBe('TestMTConnect');
      expect(connector.host).toBe('192.168.1.100');
      expect(connector.mtConnectPort).toBe(5000);
      expect(connector.connected).toBe(false);
      expect(connector.type).toBe('mtconnect');
    });

    it('should use default port when not provided', () => {
      expect(newConnector().mtConnectPort).toBe(5000);
    });

    it('should generate id from timestamp if not provided', () => {
      // ID is generated with "machine_" prefix from base class
      expect(newConnector().id).toMatch(/^machine_\d+$/);
    });

    it('should accept optional deviceId filter', () => {
      expect(newConnector({ mtConnectDeviceId: 'device123' }).mtConnectDeviceId).toBe('device123');
    });

    it('should accept optional agentType', () => {
      expect(newConnector({ agentType: 'okuma' }).agentType).toBe('okuma');
    });

    it('uses the FTP defaults when none are set', () => {
      expect(newConnector().getStatus()).toMatchObject({ ftpPort: 21, ftpUser: 'anonymous', hasFtpPassword: false });
    });
  });

  describe('disconnect', () => {
    it('should set connected to false', () => {
      connector.connected = true;
      connector.disconnect();

      expect(connector.connected).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      connector.disconnect();
      connector.disconnect();
      expect(connector.connected).toBe(false);
    });
  });

  describe('checkConnection', () => {
    it('should return false when not connected', () => {
      expect(connector.checkConnection()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return current status object', () => {
      const status = connector.getStatus();

      expect(status.id).toBe('test_mtconnect');
      expect(status.name).toBe('TestMTConnect');
      expect(status.host).toBe('192.168.1.100');
      expect(status.mtConnectPort).toBe(5000);
      expect(status.type).toBe('mtconnect');
      expect(status.connected).toBe(false);
      expect(status.errors).toEqual([]);
      expect(status.data).toBeDefined();
    });

    it('should include lastPollTime as null when not polled', () => {
      expect(connector.getStatus().lastPollTime).toBeNull();
    });

    it('should include macros when configured', () => {
      const macroConnector = newConnector({
        macros: [
          { location: 100, name: 'Variable 100' },
          { location: 200 }
        ]
      });

      const status = macroConnector.getStatus();
      expect(status.macros).toHaveLength(2);
      expect(status.macros![0].location).toBe(100);
      expect(status.macros![0].name).toBe('Variable 100');
      expect(status.macros![1].location).toBe(200);
      expect(status.macros![1].name).toBeUndefined();
    });
  });

  describe('updateMacros', () => {
    it('should update macros configuration', () => {
      connector.updateMacros([{ location: 500, name: 'New Macro' }]);

      const status = connector.getStatus();
      expect(status.macros).toHaveLength(1);
      expect(status.macros![0].location).toBe(500);
      expect(status.macros![0].name).toBe('New Macro');
    });
  });
});

describe('MTConnect agent URLs', () => {
  it('probes the agent on its host and port, then asks for the current values of the found items', async () => {
    const httpGet = serveReplies(url => (url.includes('/probe') ? PROBE : '<MTConnectStreams/>'));

    await newConnector({ mtConnectPort: 5001 }).poll();

    expect(httpGet).toHaveBeenNthCalledWith(1, 'http://192.168.1.100:5001/probe');
    const currentUrl = new URL(httpGet.mock.calls[1][0]);
    expect(currentUrl.pathname).toBe('/current');
    expect(currentUrl.searchParams.get('path')).toBe('//DataItem[@category="CONDITION" or @id="mode"]');
  });
});

describe('MTConnect probe errors', () => {
  async function connectWithProbe(probe: string, config: Partial<MTConnectMachineConfig> = {}) {
    serveReplies(() => probe);
    const connector = newConnector(config);
    await connector.connect();
    return connector;
  }

  it('is not connected when the probe has no MTConnectDevices root', async () => {
    const connector = await connectWithProbe('<Other/>');

    expect(connector.connected).toBe(false);
    expect(connector.getStatus().errors).toEqual(['Connection failed: Invalid probe response: missing MTConnectDevices']);
  });

  it('is not connected when the probe has none of the data items that Chatter reads', async () => {
    const connector = await connectWithProbe('<MTConnectDevices><Devices><Device id="d1"/></Devices></MTConnectDevices>');

    expect(connector.getStatus().errors).toEqual(['Connection failed: No matching data items found in probe response']);
  });

  it('is not connected when the configured device is not in the probe', async () => {
    const connector = await connectWithProbe(PROBE, { mtConnectDeviceId: 'nonexistent' });

    expect(connector.getStatus().errors).toEqual(["Connection failed: Device with id 'nonexistent' not found"]);
  });

  it('connects to the configured device', async () => {
    const connector = await connectWithProbe(PROBE, { mtConnectDeviceId: 'd1' });

    expect(connector.connected).toBe(true);
    expect(connector.checkConnection()).toBe(true);
  });
});

describe('MTConnect HTTP errors', () => {
  it('reports the HTTP status when the agent does not answer OK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' }));
    const connector = newConnector();

    await connector.connect();

    expect(connector.getStatus().errors).toEqual(['Connection failed: HTTP 404: Not Found']);
  });

  it('reports a timeout when the agent does not answer in time', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort);
    const connector = newConnector({ timeout: 5000 });

    await connector.connect();

    expect(connector.getStatus().errors).toEqual(['Connection failed: Request timeout after 5000ms']);
  });
});

describe('MTConnect port scan', () => {
  it('tries the MTConnect agent default port first', () => {
    expect(MTConnectConnector.COMMON_PORTS[0]).toBe(5000);
    expect(MTConnectConnector.COMMON_PORTS).toContain(5001);
    expect(MTConnectConnector.COMMON_PORTS).toContain(7878);
  });

  it('includes HTTP ports for web-based agents', () => {
    expect(MTConnectConnector.COMMON_PORTS).toContain(80);
    expect(MTConnectConnector.COMMON_PORTS).toContain(8080);
    expect(MTConnectConnector.COMMON_PORTS).toContain(8081);
  });

  it('finds the ports where an MTConnect agent answers the probe', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const port = new URL(String(input)).port;
      return new Response(port === '5001' || port === '8080' ? '<MTConnectDevices/>' : '<html/>');
    });

    expect(await MTConnectConnector.scanAllPorts('192.168.1.100')).toEqual([5001, 8080]);
    expect(await MTConnectConnector.scanForPort('192.168.1.100')).toBe(5001);
  });
});
