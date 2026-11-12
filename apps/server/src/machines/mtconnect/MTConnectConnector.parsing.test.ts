import { describe, it, expect, vi, afterEach } from 'vitest';
import { MTConnectConnector } from './MTConnectConnector.js';
import { DmgMoriConnector } from './DmgMoriConnector.js';

/**
 * These tests feed real-shaped MTConnect XML to the connector and check what it reads.
 * The shapes follow the MTConnect 1.3+ schemas and the Mazak demo agent.
 */

interface ProbeItem {
  id: string;
  type: string;
  category?: 'EVENT' | 'SAMPLE' | 'CONDITION';
  subType?: string;
  units?: string;
}

const STANDARD_ITEMS: ProbeItem[] = [
  { id: 'mode', type: 'CONTROLLER_MODE' },
  { id: 'exec', type: 'EXECUTION' },
  { id: 'estop', type: 'EMERGENCY_STOP' },
  { id: 'speed', type: 'ROTARY_VELOCITY', category: 'SAMPLE', subType: 'ACTUAL' },
  { id: 'system', type: 'SYSTEM', category: 'CONDITION' },
];

function dataItemsXml(items: ProbeItem[]): string {
  const dataItems = items.map(item =>
    `<DataItem id="${item.id}" type="${item.type}" category="${item.category ?? 'EVENT'}"`
    + `${item.subType ? ` subType="${item.subType}"` : ''}${item.units ? ` units="${item.units}"` : ''}/>`
  ).join('');
  return `<DataItems>${dataItems}</DataItems>`;
}

/** A probe with the given data items on the device, and optional axis components (Linear, Rotary) */
function probeXml(items: ProbeItem[], axes = ''): string {
  const components = axes ? `<Components><Axes id="axes"><Components>${axes}</Components></Axes></Components>` : '';
  return `<MTConnectDevices xmlns="urn:mtconnect.org:MTConnectDevices:1.3">
    <Devices><Device id="d1" name="M1" uuid="u1">${dataItemsXml(items)}${components}</Device></Devices>
  </MTConnectDevices>`;
}

function axisXml(kind: 'Linear' | 'Rotary', name: string, items: ProbeItem[]): string {
  return `<${kind} id="${name.toLowerCase()}" name="${name}">${dataItemsXml(items)}</${kind}>`;
}

interface StreamValues {
  events?: string;
  samples?: string;
  condition?: string;
}

function componentStream(values: StreamValues): string {
  return `<ComponentStream component="Device" componentId="d1">
    ${values.events ? `<Events>${values.events}</Events>` : ''}
    ${values.samples ? `<Samples>${values.samples}</Samples>` : ''}
    ${values.condition ? `<Condition>${values.condition}</Condition>` : ''}
  </ComponentStream>`;
}

function currentXml(deviceStreams: string[]): string {
  return `<MTConnectStreams xmlns="urn:mtconnect.org:MTConnectStreams:1.3">
    <Streams>${deviceStreams.join('')}</Streams>
  </MTConnectStreams>`;
}

function deviceStream(values: StreamValues, name = 'M1'): string {
  return `<DeviceStream name="${name}" uuid="${name}">${componentStream(values)}</DeviceStream>`;
}

const IDLE_EVENTS = `
  <ControllerMode dataItemId="mode">AUTOMATIC</ControllerMode>
  <Execution dataItemId="exec">READY</Execution>
  <EmergencyStop dataItemId="estop">ARMED</EmergencyStop>`;
const NORMAL_CONDITION = '<Normal dataItemId="system" type="SYSTEM"/>';

/** Make the connector read the given probe and current XML instead of calling a real agent. */
function serveAgent(probe: string, current: string): void {
  vi.spyOn(MTConnectConnector.prototype as unknown as { httpGet: (url: string) => Promise<string> }, 'httpGet')
    .mockImplementation(async (url: string) => (url.includes('/probe') ? probe : current));
}

async function pollGeneric(probe: string, current: string) {
  serveAgent(probe, current);
  const connector = new MTConnectConnector({ name: 'Test', host: '127.0.0.1' });
  return (await connector.poll()).data;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MTConnect part count', () => {
  it('reads a PART_COUNT that has no subType, like the Mazak agent sends', async () => {
    const probe = probeXml([...STANDARD_ITEMS, { id: 'pc', type: 'PART_COUNT' }]);
    const current = currentXml([deviceStream({ events: `${IDLE_EVENTS}<PartCount dataItemId="pc">42</PartCount>` })]);

    const data = await pollGeneric(probe, current);

    expect(data.partCount).toBe(42);
  });

  it('prefers the PART_COUNT with subType ALL when the agent has both', async () => {
    const probe = probeXml([
      ...STANDARD_ITEMS,
      { id: 'pc_plain', type: 'PART_COUNT' },
      { id: 'pc_all', type: 'PART_COUNT', subType: 'ALL' },
      { id: 'pc_goal', type: 'PART_COUNT', subType: 'TARGET' },
    ]);
    const current = currentXml([deviceStream({
      events: `${IDLE_EVENTS}
        <PartCount dataItemId="pc_plain">1</PartCount>
        <PartCount dataItemId="pc_all">7</PartCount>
        <PartCount dataItemId="pc_goal">50</PartCount>`,
    })]);

    const data = await pollGeneric(probe, current);

    expect(data.partCount).toBe(7);
    expect(data.partGoal).toBe(50);
  });
});

describe('MTConnect alarm', () => {
  it('is not an alarm when the machine is stopped normally', async () => {
    const events = IDLE_EVENTS.replace('READY', 'STOPPED');
    const current = currentXml([deviceStream({ events, condition: NORMAL_CONDITION })]);

    const data = await pollGeneric(probeXml(STANDARD_ITEMS), current);

    expect(data.alarm).toBe(false);
    expect(data.alarmCode).toBeUndefined();
  });

  it('is an alarm with the native code and text when a condition reports a Fault', async () => {
    const condition = '<Fault dataItemId="system" type="SYSTEM" nativeCode="1132">Spindle overload</Fault>';
    const current = currentXml([deviceStream({ events: IDLE_EVENTS, condition })]);

    const data = await pollGeneric(probeXml(STANDARD_ITEMS), current);

    expect(data.alarm).toBe(true);
    expect(data.alarmCode).toBe('1132');
    expect(data.alarmText).toBe('Spindle overload');
  });

  it('is not an alarm when a condition reports only a Warning', async () => {
    const condition = '<Warning dataItemId="system" type="SYSTEM" nativeCode="2203">Tool life</Warning>';
    const current = currentXml([deviceStream({ events: IDLE_EVENTS, condition })]);

    const data = await pollGeneric(probeXml(STANDARD_ITEMS), current);

    expect(data.alarm).toBe(false);
  });

  it('is an alarm when the emergency stop is pressed', async () => {
    const events = IDLE_EVENTS.replace('ARMED', 'TRIGGERED');
    const current = currentXml([deviceStream({ events, condition: NORMAL_CONDITION })]);

    const data = await pollGeneric(probeXml(STANDARD_ITEMS), current);

    expect(data.alarm).toBe(true);
    expect(data.alarmCode).toBe('EMERGENCY_STOP');
  });
});

describe('MTConnect streams', () => {
  it('reads the machine when the agent also sends its own Agent device stream', async () => {
    const agentStream = `<DeviceStream name="Agent" uuid="agent"><ComponentStream component="Agent" componentId="agent">
      <Events><Availability dataItemId="agent_avail">AVAILABLE</Availability></Events></ComponentStream></DeviceStream>`;
    const current = currentXml([agentStream, deviceStream({
      events: IDLE_EVENTS,
      samples: '<RotaryVelocity dataItemId="speed">12000</RotaryVelocity>',
    })]);

    const data = await pollGeneric(probeXml(STANDARD_ITEMS), current);

    expect(data.mode).toBe('AUTOMATIC');
    expect(data.spindleSpeed).toBe(12000);
  });
});

describe('MTConnect spindle load', () => {
  const DEVICE_ITEMS = STANDARD_ITEMS.filter(item => item.type !== 'ROTARY_VELOCITY');
  const percentLoad = (id: string): ProbeItem => ({ id, type: 'LOAD', category: 'SAMPLE', units: 'PERCENT' });
  const X_AXIS = axisXml('Linear', 'X', [percentLoad('Xload')]);
  const spindle = (items: ProbeItem[]) => axisXml('Rotary', 'C', [
    { id: 'Srpm', type: 'ROTARY_VELOCITY', category: 'SAMPLE', subType: 'ACTUAL' },
    ...items,
  ]);
  const samples = (spindleLoad = '37.5') => `
    <Load dataItemId="Xload">49</Load>
    <Load dataItemId="Cload">12</Load>
    <Load dataItemId="Sload">${spindleLoad}</Load>
    <RotaryVelocity dataItemId="Srpm">2194</RotaryVelocity>`;

  async function pollSpindle(spindleItems: ProbeItem[], spindleLoad?: string) {
    const probe = probeXml(DEVICE_ITEMS, X_AXIS + spindle(spindleItems));
    return pollGeneric(probe, currentXml([deviceStream({ events: IDLE_EVENTS, samples: samples(spindleLoad) })]));
  }

  it('reads the load on the spindle, not the load of the X axis that comes first', async () => {
    const data = await pollSpindle([percentLoad('Sload')]);

    expect(data.spindleSpeed).toBe(2194);
    expect(data.spindleLoad).toBe(37.5);
  });

  it('does not take a load alarm (a CONDITION) for the load', async () => {
    const data = await pollSpindle([{ id: 'Sload_cond', type: 'LOAD', category: 'CONDITION' }, percentLoad('Sload')]);

    expect(data.spindleLoad).toBe(37.5);
  });

  it('takes the load with the same name start as the spindle speed when the spindle has two loads, like Mazak Cload and Sload', async () => {
    const data = await pollSpindle([percentLoad('Cload'), percentLoad('Sload')]);

    expect(data.spindleLoad).toBe(37.5);
  });

  it('reads no spindle load when the spindle has no load item', async () => {
    const data = await pollSpindle([]);

    expect(data.spindleLoad).toBeUndefined();
  });

  it('reads no spindle load when the agent says it is UNAVAILABLE, because 0 would be a real load', async () => {
    const data = await pollSpindle([percentLoad('Sload')], 'UNAVAILABLE');

    expect(data.spindleLoad).toBeUndefined();
  });

  it('gives the spindle load in the snapshot for the history', async () => {
    serveAgent(
      probeXml(DEVICE_ITEMS, X_AXIS + spindle([percentLoad('Sload')])),
      currentXml([deviceStream({ events: IDLE_EVENTS, samples: samples() })]),
    );
    const connector = new MTConnectConnector({ name: 'Test', host: '127.0.0.1' });
    await connector.poll();

    expect(connector.getDataSnapshot().spindleLoad).toBe(37.5);
  });
});

describe('DMG Mori alarm', () => {
  async function pollDmg(current: string) {
    serveAgent(probeXml(STANDARD_ITEMS), current);
    const connector = new DmgMoriConnector({ name: 'DMU', host: '127.0.0.1' });
    return (await connector.poll()).data;
  }

  it('is not an alarm while the machine waits for the next part', async () => {
    const data = await pollDmg(currentXml([deviceStream({ events: IDLE_EVENTS, condition: NORMAL_CONDITION })]));

    expect(data.execution).toBe('READY');
    expect(data.alarm).toBe(false);
    expect(data.alarmCode).toBeUndefined();
  });

  it('is an alarm when a condition reports a Fault', async () => {
    const condition = '<Fault dataItemId="system" type="SYSTEM" nativeCode="3000">EMERGENCY STOP</Fault>';
    const data = await pollDmg(currentXml([deviceStream({ events: IDLE_EVENTS, condition })]));

    expect(data.alarm).toBe(true);
    expect(data.alarmCode).toBe('3000');
  });
});
