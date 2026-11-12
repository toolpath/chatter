import { BaseMachineConnector, errorMessage } from '../BaseMachineConnector.js';
import { parseStringPromise } from 'xml2js';
import { DEFAULT_MTCONNECT_PORT } from '@local-chatter/shared';
import type {
  MTConnectMachineConfig,
  MTConnectMachineStatus,
  MacroConfig,
  MTConnectMachineData,
  MachineType,
  MachineDataSnapshot,
} from '../../types/index.js';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('mtconnect');

// ============================================
// Data items that the connector reads
// ============================================

interface DataItemDefinition {
  type: string;              // MTConnect DataItem type (e.g., 'PROGRAM', 'TOOL_NUMBER')
  normalizedName: string;    // Our normalized field name (e.g., 'program', 'toolNumber')
  valueType: 'string' | 'int' | 'float' | 'bool';
  subType?: string;          // Optional subType filter (e.g., 'ALL', 'TARGET')
  // Also accept an item with no subType when no item has the subType (Mazak sends PART_COUNT with none)
  acceptMissingSubType?: boolean;
}

interface DiscoveredDataItem extends DataItemDefinition {
  id: string;                // Discovered dataItemId from probe
}

const DATA_ITEMS: DataItemDefinition[] = [
  { type: 'CONTROLLER_MODE', normalizedName: 'mode', valueType: 'string' },
  { type: 'PROGRAM', normalizedName: 'program', valueType: 'string' },
  { type: 'PART_COUNT', normalizedName: 'partCount', valueType: 'int', subType: 'ALL', acceptMissingSubType: true },
  { type: 'PART_COUNT', normalizedName: 'partGoal', valueType: 'int', subType: 'TARGET' },
  { type: 'TOOL_NUMBER', normalizedName: 'toolNumber', valueType: 'int' },
  { type: 'ROTARY_VELOCITY', normalizedName: 'spindleSpeed', valueType: 'int' },
  { type: 'EXECUTION', normalizedName: 'execution', valueType: 'string' },
  { type: 'EMERGENCY_STOP', normalizedName: 'emergencyStop', valueType: 'string' },
];

/** A Condition element that reports a fault (the machine's alarm) */
interface ActiveFault {
  nativeCode?: string;
  text?: string;
}

type XmlAttributes = Record<string, string>;
type XmlElement = Record<string, unknown>;

const XML_OPTIONS = { explicitArray: false };
const DEFAULT_SCAN_TIMEOUT_MS = 2000;

const EMERGENCY_STOP_PRESSED = 'TRIGGERED';
const EMERGENCY_STOP_ALARM_CODE = 'EMERGENCY_STOP';
const EMERGENCY_STOP_ALARM_TEXT = 'Emergency stop';

// ============================================
// XML helpers (xml2js gives one child as an object, several as an array)
// ============================================

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/** Follow the path of child names, with or without the "m:" namespace prefix */
function getNestedProperty(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    const record = current as XmlElement;
    current = record[key] || record[`m:${key}`];
  }
  return current;
}

/** xml2js gives an element with attributes as { $: attrs, _: text }, or a plain string. */
function readElement(element: unknown): { attrs?: XmlAttributes; text?: string } {
  if (!element || typeof element !== 'object') return {};
  const record = element as XmlElement;
  const text = typeof record._ === 'string' ? record._ : undefined;
  return { attrs: record.$ as XmlAttributes | undefined, text };
}

/** The device and every component in it, at any depth */
function collectComponents(element: unknown): XmlElement[] {
  if (!element || typeof element !== 'object') return [];
  const record = element as XmlElement;
  const found = [record];

  const components = getNestedProperty(record, ['Components']);
  if (components && typeof components === 'object') {
    for (const children of Object.values(components as XmlElement)) {
      for (const child of ensureArray(children)) {
        found.push(...collectComponents(child));
      }
    }
  }
  return found;
}

/** The attributes of the data items that sit on this component, not on its child components */
function ownDataItemAttrs(component: XmlElement): XmlAttributes[] {
  const dataItems = getNestedProperty(component, ['DataItems']);
  if (!dataItems || typeof dataItems !== 'object') return [];
  return ensureArray(getNestedProperty(dataItems, ['DataItem']))
    .map(item => (item as XmlElement)?.$ as XmlAttributes | undefined)
    .filter((attrs): attrs is XmlAttributes => Boolean(attrs?.id));
}

/** The attributes of every data item in the device, at any depth */
function allDataItemAttrs(device: unknown): XmlAttributes[] {
  return collectComponents(device).flatMap(ownDataItemAttrs);
}

/**
 * The id of the first data item of this type in the device.
 * subType undefined matches any subType; subType null matches only items with no subType.
 */
function findDataItemId(device: unknown, type: string, subType?: string | null): string | null {
  const match = allDataItemAttrs(device).find(attrs => {
    if (attrs.type !== type) return false;
    if (subType === undefined) return true;
    return subType === null ? !attrs.subType : attrs.subType === subType;
  });
  return match?.id || null;
}

function finiteOrUndefined(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

/** The start of a data item's id or name, without the given ending (Sload -> s, S1speed -> s1) */
function nameStarts(attrs: XmlAttributes, ending: RegExp): string[] {
  return [attrs.id, attrs.name]
    .filter((name): name is string => Boolean(name))
    .map(name => name.replace(ending, '').toLowerCase());
}

/**
 * Pick the spindle load from the data items of the spindle's component: a SAMPLE LOAD in percent.
 * When there are two (Mazak puts Cload and Sload on one Rotary), take the one whose name
 * starts like the speed's (Srpm -> Sload). When no name matches, give none, not a guess.
 */
function pickSpindleLoadId(items: XmlAttributes[], speed: XmlAttributes): string | null {
  const loads = items.filter(attrs =>
    attrs.type === 'LOAD' && attrs.category === 'SAMPLE' && (attrs.units ?? 'PERCENT') === 'PERCENT');
  if (loads.length <= 1) return loads[0]?.id ?? null;

  const speedStarts = nameStarts(speed, /(speed|rpm)$/i);
  const match = loads.find(load => nameStarts(load, /load$/i).some(start => speedStarts.includes(start)));
  return match?.id ?? null;
}

/**
 * Find the spindle load: a percent LOAD sample on the component that holds the spindle speed.
 * A plain LOAD lookup would find an axis load (X comes first), and LOAD is also a CONDITION type.
 */
function findSpindleLoadId(device: unknown, speedId: string): string | null {
  const spindleItems = collectComponents(device)
    .map(ownDataItemAttrs)
    .find(items => items.some(attrs => attrs.id === speedId));
  const speed = spindleItems?.find(attrs => attrs.id === speedId);
  if (!spindleItems || !speed) return null;

  return pickSpindleLoadId(spindleItems, speed);
}

/** GET a URL and read its body. Throws when the reply is not OK, or takes longer than timeoutMs. */
async function getText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================
// MTConnect Connector Class
// ============================================

export class MTConnectConnector extends BaseMachineConnector {
  readonly type: MachineType = 'mtconnect';

  public mtConnectPort: number;
  public mtConnectDeviceId?: string;
  public agentType: string;
  protected macros: MacroConfig[];

  protected dataItems: DiscoveredDataItem[] = [];
  protected probeComplete: boolean = false;

  /** The port scan runs once, after the first failed connection */
  protected portScanAttempted: boolean = false;

  protected data: MTConnectMachineData = {};
  protected prevData: MTConnectMachineData = {};

  constructor(config: MTConnectMachineConfig) {
    super(config);
    this.mtConnectPort = config.mtConnectPort ?? DEFAULT_MTCONNECT_PORT;
    this.mtConnectDeviceId = config.mtConnectDeviceId;
    this.agentType = config.agentType ?? 'generic';
    this.macros = config.macros ?? [];
  }

  /** The ports to look for an agent on, most likely first */
  static readonly COMMON_PORTS = [
    5000,  // MTConnect agent default
    5001,  // Second agent on the same PC
    7878,  // Adapter (SHDR) port; some setups put an agent here
    5002,  // Some adapters
    80,    // HTTP default (some web-based agents)
    8080,  // Alternate HTTP
    8081,  // Alternate HTTP
  ];

  /** The first common port with an MTConnect agent on this host, or null */
  static async scanForPort(host: string, timeout: number = DEFAULT_SCAN_TIMEOUT_MS): Promise<number | null> {
    for (const port of MTConnectConnector.COMMON_PORTS) {
      if (await MTConnectConnector.probePort(host, port, timeout)) {
        return port;
      }
    }
    return null;
  }

  /** Every common port with an MTConnect agent on this host */
  static async scanAllPorts(host: string, timeout: number = DEFAULT_SCAN_TIMEOUT_MS): Promise<number[]> {
    const found = await Promise.all(
      MTConnectConnector.COMMON_PORTS.map(port => MTConnectConnector.probePort(host, port, timeout))
    );
    return MTConnectConnector.COMMON_PORTS.filter((_, i) => found[i]);
  }

  /** True when an MTConnect agent answers the probe on this port */
  static async probePort(host: string, port: number, timeout: number = DEFAULT_SCAN_TIMEOUT_MS): Promise<boolean> {
    try {
      const text = await getText(`http://${host}:${port}/probe`, timeout);
      return text.includes('MTConnectDevices') || text.includes('m:MTConnectDevices');
    } catch {
      return false;
    }
  }

  /**
   * Probe the agent for the data items of the device.
   * A failed probe is recorded in the errors; it does not throw.
   */
  async connect(): Promise<void> {
    this.connected = false;
    this.clearErrors();

    try {
      await this.probe();
      this.connected = true;
      this.probeComplete = true;
    } catch (err) {
      this.addError(`Connection failed: ${errorMessage(err, String(err))}`);
      this.connected = false;
    }
  }

  disconnect(): void {
    this.connected = false;
    this.probeComplete = false;
    this.dataItems = [];
  }

  checkConnection(): boolean {
    return this.connected && this.probeComplete;
  }

  /** Read the probe, and find the ids of the data items that Chatter reads */
  protected async probe(): Promise<void> {
    const response = await this.httpGet(this.buildUrl('/probe'));
    const parsed = await parseStringPromise(response, XML_OPTIONS);

    const root = parsed.MTConnectDevices || parsed['m:MTConnectDevices'];
    if (!root) {
      throw new Error('Invalid probe response: missing MTConnectDevices');
    }

    this.dataItems = this.discoverDataItems(this.findDevice(root));
    if (this.dataItems.length === 0) {
      throw new Error('No matching data items found in probe response');
    }
  }

  /** The device with the configured id, else the first device */
  private findDevice(root: XmlElement): XmlElement | undefined {
    const devices = ensureArray(getNestedProperty(root, ['Devices', 'Device'])) as XmlElement[];
    if (!this.mtConnectDeviceId) return devices[0];

    const device = devices.find(d => (d.$ as XmlAttributes | undefined)?.id === this.mtConnectDeviceId);
    if (!device) {
      throw new Error(`Device with id '${this.mtConnectDeviceId}' not found`);
    }
    return device;
  }

  private discoverDataItems(device: XmlElement | undefined): DiscoveredDataItem[] {
    const discovered: DiscoveredDataItem[] = [];
    for (const definition of DATA_ITEMS) {
      const id = findDataItemId(device, definition.type, definition.subType)
        ?? (definition.acceptMissingSubType ? findDataItemId(device, definition.type, null) : null);
      if (id) {
        discovered.push({ ...definition, id });
      }
    }

    const speedId = discovered.find(item => item.normalizedName === 'spindleSpeed')?.id;
    const spindleLoadId = speedId ? findSpindleLoadId(device, speedId) : null;
    if (spindleLoadId) {
      discovered.push({ type: 'LOAD', normalizedName: 'spindleLoad', valueType: 'float', id: spindleLoadId });
    }
    return discovered;
  }

  async poll(): Promise<MTConnectMachineStatus> {
    this.clearErrors();

    if (!this.connected || !this.probeComplete) {
      if (!(await this.connectOrScanForAgent())) {
        return this.getStatus();
      }
    }

    this.prevData = { ...this.data };

    try {
      await this.fetchCurrentData();
      this.updatePollTime();
      this.emitDataChanges(this.prevData, this.data);
    } catch (err) {
      // Not connected, so the next poll probes the agent again
      this.addPollError(err);
      this.connected = false;
    }

    return this.getStatus();
  }

  /** Connect. After the first failure, scan the common ports for the agent and connect there. */
  private async connectOrScanForAgent(): Promise<boolean> {
    if (await this.ensureConnected()) return true;
    if (this.portScanAttempted) return false;

    this.portScanAttempted = true;
    log.info('Connection failed, scanning the common ports for the MTConnect agent', { machine: this.id, name: this.name });
    const detectedPort = await MTConnectConnector.scanForPort(this.host);
    if (!detectedPort || detectedPort === this.mtConnectPort) {
      log.info('No MTConnect agent found on the common ports', { machine: this.id, name: this.name });
      return false;
    }

    log.info('Found the MTConnect agent on another port, connecting there', { machine: this.id, name: this.name, port: detectedPort });
    this.mtConnectPort = detectedPort;
    return this.ensureConnected();
  }

  protected async fetchCurrentData(): Promise<void> {
    // Ask for our data items and every condition (a Fault on any condition is an alarm)
    const ids = this.dataItems.map(item => `@id="${item.id}"`);
    const path = `//DataItem[${['@category="CONDITION"', ...ids].join(' or ')}]`;

    const response = await this.httpGet(this.buildUrl('/current', { path }));
    const parsed = await parseStringPromise(response, XML_OPTIONS);

    const root = parsed.MTConnectStreams || parsed['m:MTConnectStreams'];
    if (!root) {
      throw new Error('Invalid current response: missing MTConnectStreams');
    }

    const values = this.collectCurrentValues(root);
    for (const item of this.dataItems) {
      const current = values.get(item.id);
      if (current !== undefined) {
        this.data[item.normalizedName] = this.convertValue(current, item.valueType);
      }
    }

    this.updateAlarm(this.collectActiveFaults(root));
  }

  /** A float that is not a number (UNAVAILABLE) gives undefined, because 0 is a real value */
  private convertValue(text: string, valueType: DataItemDefinition['valueType']): string | number | boolean | undefined {
    switch (valueType) {
      case 'int': return parseInt(text, 10) || 0;
      case 'float': return finiteOrUndefined(parseFloat(text));
      case 'bool': return Boolean(text);
      case 'string': return text;
    }
  }

  /**
   * The machine is in alarm when the emergency stop is pressed or any condition reports a Fault.
   * A normal stop (EXECUTION = STOPPED or READY) is not an alarm.
   */
  protected updateAlarm(faults: ActiveFault[]): void {
    const emergencyStopPressed = String(this.data.emergencyStop ?? '').toUpperCase() === EMERGENCY_STOP_PRESSED;
    this.data.alarm = emergencyStopPressed || faults.length > 0;
    this.data.alarmCode = faults[0]?.nativeCode ?? (emergencyStopPressed ? EMERGENCY_STOP_ALARM_CODE : undefined);
    this.data.alarmText = faults[0]?.text ?? (emergencyStopPressed ? EMERGENCY_STOP_ALARM_TEXT : undefined);
  }

  /** The current event and sample values of the streams reply, by dataItemId */
  protected collectCurrentValues(root: unknown): Map<string, string> {
    const values = new Map<string, string>();
    this.forEachStreamElement(root, ['Events', 'Samples'], (_tag, attrs, text) => {
      if (text !== undefined) values.set(attrs.dataItemId, text);
    });
    return values;
  }

  /** Every Condition element that is a Fault. Normal, Warning and Unavailable are not alarms. */
  protected collectActiveFaults(root: unknown): ActiveFault[] {
    const faults: ActiveFault[] = [];
    this.forEachStreamElement(root, ['Condition'], (tag, attrs, text) => {
      if (tag === 'Fault') faults.push({ nativeCode: attrs.nativeCode, text });
    });
    return faults;
  }

  /**
   * Visit each data element (with a dataItemId) in the given categories of every component stream.
   * An agent can send several DeviceStreams, for example its own "Agent" device.
   */
  private forEachStreamElement(
    root: unknown,
    categories: string[],
    visit: (tag: string, attrs: XmlAttributes, text: string | undefined) => void
  ): void {
    const deviceStreams = ensureArray(getNestedProperty(root, ['Streams', 'DeviceStream']));
    const componentStreams = deviceStreams.flatMap(deviceStream =>
      ensureArray(getNestedProperty(deviceStream, ['ComponentStream'])));

    for (const stream of componentStreams) {
      for (const category of categories) {
        const categoryData = getNestedProperty(stream, [category]);
        if (!categoryData || typeof categoryData !== 'object') continue;

        for (const [tag, tagValue] of Object.entries(categoryData as XmlElement)) {
          for (const element of ensureArray(tagValue)) {
            const { attrs, text } = readElement(element);
            if (attrs?.dataItemId) visit(tag.replace(/^m:/, ''), attrs, text);
          }
        }
      }
    }
  }

  getStatus(): MTConnectMachineStatus {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      type: 'mtconnect',
      mtConnectPort: this.mtConnectPort,
      mtConnectDeviceId: this.mtConnectDeviceId,
      agentType: this.agentType,
      ftpPort: this.ftpPort,
      ftpUser: this.ftpUser,
      hasFtpPassword: this.hasFtpPassword,
      connected: this.connected,
      lastPollTime: this.lastPollTime,
      errors: this.errors,
      data: { ...this.data },
      macros: this.macros,
    };
  }

  updateMacros(macros: MacroConfig[]): void {
    this.macros = macros;
  }

  getDataSnapshot(): MachineDataSnapshot {
    const custom: Record<string, string | number | boolean> = {};
    if (this.data.execution !== undefined) {
      custom.execution = this.data.execution;
    }

    return this.buildSnapshot({
      mode: this.data.mode as string | undefined,
      execution: this.data.execution as string | undefined,
      program: this.data.program as string | undefined,
      spindleSpeed: this.data.spindleSpeed as number | undefined,
      spindleLoad: this.data.spindleLoad as number | undefined,
      toolNumber: this.data.toolNumber as number | undefined,
      partCount: this.data.partCount as number | undefined,
      partGoal: this.data.partGoal as number | undefined,
      alarm: this.data.alarm as boolean | undefined,
      alarmCode: this.data.alarmCode as string | undefined,
    }, { ...custom, ...this.macroValues(this.macros, this.data) });
  }

  protected buildUrl(path: string, params?: Record<string, string>): string {
    const url = `http://${this.host}:${this.mtConnectPort}${path}`;
    return params ? `${url}?${new URLSearchParams(params).toString()}` : url;
  }

  protected httpGet(url: string): Promise<string> {
    return getText(url, this.timeout);
  }
}
