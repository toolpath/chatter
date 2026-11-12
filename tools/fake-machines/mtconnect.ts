import http from 'http';
import type { MachineSimulator, MachineState, Mode } from './simulator.js';

/**
 * Fake MTConnect agent: answers GET /probe and GET /current with MTConnect XML.
 * Okuma (THINC), Mazak, Hurco and DMG Mori machines all report data this way.
 */

export interface AgentIdentity {
  deviceId: string;
  deviceName: string;
  uuid: string;
  manufacturer: string;
  model: string;
}

/** MTConnect CONTROLLER_MODE values for each control mode */
const CONTROLLER_MODES: Record<Mode, string> = {
  MANUAL: 'MANUAL',
  MDI: 'MANUAL_DATA_INPUT',
  MEMORY: 'AUTOMATIC',
  EDIT: 'EDIT',
};

const MTCONNECT_VERSION = '1.3';
const NAMESPACE = `urn:mtconnect.org:MTConnectDevices:${MTCONNECT_VERSION}`;
const STREAMS_NAMESPACE = `urn:mtconnect.org:MTConnectStreams:${MTCONNECT_VERSION}`;

export function startMTConnectAgent(
  simulator: MachineSimulator,
  identity: AgentIdentity,
  host: string,
  port: number
): http.Server {
  const startedAt = Date.now();
  let sequence = 1;
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://agent').pathname;
    const header = { instanceId: startedAt, sequence: sequence++ };
    if (path.endsWith('/probe')) return sendXml(response, probeXml(identity, header));
    if (path.endsWith('/current')) return sendXml(response, currentXml(identity, simulator.getState(), header));
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  });
  server.listen(port, host);
  return server;
}

interface Header {
  instanceId: number;
  sequence: number;
}

function sendXml(response: http.ServerResponse, xml: string): void {
  response.writeHead(200, { 'Content-Type': 'application/xml' }).end(xml);
}

/** The probe header has no sequence numbers; the streams header does. */
function headerXml(header: Header, withSequences: boolean): string {
  const sequences = withSequences
    ? ` firstSequence="1" lastSequence="${header.sequence}" nextSequence="${header.sequence + 1}"`
    : '';
  return `<Header creationTime="${new Date().toISOString()}" sender="fake-machines" instanceId="${header.instanceId}" version="${MTCONNECT_VERSION}.0" bufferSize="131072"${sequences}/>`;
}

function escapeXml(text: string | number): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function probeXml(identity: AgentIdentity, header: Header): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectDevices xmlns="${NAMESPACE}">
  ${headerXml(header, false)}
  <Devices>
    <Device id="${identity.deviceId}" name="${identity.deviceName}" uuid="${identity.uuid}">
      <Description manufacturer="${identity.manufacturer}" model="${identity.model}"/>
      <DataItems>
        <DataItem category="EVENT" id="${identity.deviceId}_avail" type="AVAILABILITY"/>
        <DataItem category="EVENT" id="${identity.deviceId}_estop" type="EMERGENCY_STOP"/>
      </DataItems>
      <Components>
        <Axes id="${identity.deviceId}_axes" name="base">
          <Components>
            <Rotary id="${identity.deviceId}_c" name="C">
              <DataItems>
                <DataItem category="SAMPLE" id="${identity.deviceId}_S1speed" type="ROTARY_VELOCITY" subType="ACTUAL" units="REVOLUTION/MINUTE" nativeUnits="REVOLUTION/MINUTE"/>
                <DataItem category="SAMPLE" id="${identity.deviceId}_S1load" type="LOAD" units="PERCENT" nativeUnits="PERCENT"/>
              </DataItems>
            </Rotary>
          </Components>
        </Axes>
        <Controller id="${identity.deviceId}_cont" name="controller">
          <DataItems>
            <DataItem category="EVENT" id="${identity.deviceId}_mode" type="CONTROLLER_MODE"/>
            <DataItem category="CONDITION" id="${identity.deviceId}_system" type="SYSTEM"/>
          </DataItems>
          <Components>
            <Path id="${identity.deviceId}_path" name="path">
              <DataItems>
                <DataItem category="EVENT" id="${identity.deviceId}_exec" type="EXECUTION"/>
                <DataItem category="EVENT" id="${identity.deviceId}_pgm" type="PROGRAM"/>
                <DataItem category="EVENT" id="${identity.deviceId}_tool" type="TOOL_NUMBER"/>
                <DataItem category="EVENT" id="${identity.deviceId}_pc" type="PART_COUNT" subType="ALL"/>
                <DataItem category="EVENT" id="${identity.deviceId}_pcgoal" type="PART_COUNT" subType="TARGET"/>
              </DataItems>
            </Path>
          </Components>
        </Controller>
      </Components>
    </Device>
  </Devices>
</MTConnectDevices>`;
}

function currentXml(identity: AgentIdentity, state: MachineState, header: Header): string {
  const id = identity.deviceId;
  const time = new Date().toISOString();
  const event = (tag: string, item: string, value: string | number) =>
    `<${tag} dataItemId="${id}_${item}" timestamp="${time}" sequence="${header.sequence}">${escapeXml(value)}</${tag}>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectStreams xmlns="${STREAMS_NAMESPACE}">
  ${headerXml(header, true)}
  <Streams>
    <DeviceStream name="${identity.deviceName}" uuid="${identity.uuid}">
      <ComponentStream component="Device" name="${identity.deviceName}" componentId="${id}">
        <Events>
          ${event('Availability', 'avail', 'AVAILABLE')}
          ${event('EmergencyStop', 'estop', state.alarm?.emergencyStop ? 'TRIGGERED' : 'ARMED')}
        </Events>
      </ComponentStream>
      <ComponentStream component="Rotary" name="C" componentId="${id}_c">
        <Samples>
          ${event('RotaryVelocity', 'S1speed', state.spindleRpm)}
          ${event('Load', 'S1load', state.spindleLoad)}
        </Samples>
      </ComponentStream>
      <ComponentStream component="Controller" name="controller" componentId="${id}_cont">
        <Events>
          ${event('ControllerMode', 'mode', CONTROLLER_MODES[state.mode])}
        </Events>
        <Condition>
          ${conditionXml(id, state, time, header)}
        </Condition>
      </ComponentStream>
      <ComponentStream component="Path" name="path" componentId="${id}_path">
        <Events>
          ${event('Execution', 'exec', state.execution)}
          ${event('Program', 'pgm', state.program.name)}
          ${event('ToolNumber', 'tool', state.toolNumber)}
          ${event('PartCount', 'pc', state.partCount)}
          ${event('PartCount', 'pcgoal', state.partGoal)}
        </Events>
      </ComponentStream>
    </DeviceStream>
  </Streams>
</MTConnectStreams>`;
}

/** An alarm shows as a Fault on the SYSTEM condition; no alarm shows as Normal. */
function conditionXml(id: string, state: MachineState, time: string, header: Header): string {
  const attributes = `dataItemId="${id}_system" timestamp="${time}" sequence="${header.sequence}" type="SYSTEM"`;
  if (!state.alarm) return `<Normal ${attributes}/>`;
  return `<Fault ${attributes} nativeCode="${escapeXml(state.alarm.code)}">${escapeXml(state.alarm.text)}</Fault>`;
}
