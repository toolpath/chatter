import type net from 'net';
import type { Execution, MachineSimulator, MachineState, Mode } from './simulator.js';
import { startRequestReplyServer, type SlowStart } from './tcp.js';

/**
 * Fake Brother Speedio control (CNC-C00 / D00) on the LOD data port (10000).
 *
 * The client sends a frame: %CLOD    <COMMAND>  \r\n\r\n<checksum>%
 * The control answers:      %RLOD    <COMMAND>00\r\n<KEY>,<value>,...\r\n\r\n<checksum>%
 * Formats copy the replies in apps/server/src/machines/brother/BrotherConnector.test.ts,
 * which were captured from real machines.
 */

/** One frame is everything between two % signs */
const FRAME_PATTERN = /%([^%]*)%/g;
/** In "CLOD    PANEL   ", the command name starts at character 8 and is 8 characters wide */
const COMMAND_START = 8;
const COMMAND_WIDTH = 8;

const MODE_NUMBERS: Record<Mode, number> = { MANUAL: 0, MDI: 1, MEMORY: 2, EDIT: 3 };
/** The MEM "operation status": 0 reset, 1 operation, 2 temporary stop (feed hold) */
const OPERATION_STATUS: Record<Execution, number> = { READY: 0, ACTIVE: 1, INTERRUPTED: 2, STOPPED: 0 };

/** The ALARM reply uses category 90 when there is no alarm */
const NO_ALARM = '9000000000';

interface ToolOffsets {
  length: number;
  diameter: number;
  name: string;
}

const TOOL_OFFSETS: Record<number, ToolOffsets> = {
  1: { length: 2.1350, diameter: 0.5000, name: 'SPOT DRILL' },
  5: { length: 3.4020, diameter: 0.2500, name: 'ENDMILL' },
  6: { length: 2.8875, diameter: 0.3750, name: 'ENDMILL' },
  12: { length: 4.0120, diameter: 0.2010, name: 'DRILL #7' },
  13: { length: 3.7500, diameter: 0.2500, name: 'TAP 1/4-20' },
  14: { length: 2.5000, diameter: 0.1250, name: 'BALL MILL' },
  15: { length: 2.9100, diameter: 0.5000, name: 'CHAMFER' },
  20: { length: 3.1000, diameter: 1.0000, name: 'FACE MILL' },
};

const INCH_TO_MM = 25.4;

export function startBrotherServer(simulator: MachineSimulator, host: string, port: number, slowStart: SlowStart): net.Server {
  return startRequestReplyServer(host, port, FRAME_PATTERN, frame => buildReply(frame, simulator.getState()), slowStart);
}

function buildReply(frame: string, state: MachineState): string {
  const command = frame.slice(COMMAND_START, COMMAND_START + COMMAND_WIDTH).trim();
  const lines = replyLines(command, state);
  const body = `RLOD    ${command.padEnd(COMMAND_WIDTH)}00\r\n${lines.join('\r\n')}\r\n\r\n`;
  return `%${body}${checksum(body)}%`;
}

function replyLines(command: string, state: MachineState): string[] {
  switch (command) {
    case 'PANEL': return [`D01,0,0,0`, `K01,${MODE_NUMBERS[state.mode]},5,0,0,0,0,0,0,0,1,0`];
    case 'MEM': return [`A01,'/       ',${state.program.number},${OPERATION_STATUS[state.execution]},0,0,0,0`];
    case 'WKCNTR': return [`A01,  1,${padLeft(state.partCount, 6)},${padLeft(state.partGoal, 6)},     0`];
    case 'PDSP': return [`X01,    0.000 ,${padLeft(state.spindleRpm, 6)},0,${state.toolNumber},10,10,0,0,0,0,4,100,100, 0,0, 0`];
    case 'ALARM': return [`E01,${state.alarm?.code ?? NO_ALARM},          ,          `];
    case 'ATCTL':
    case 'ATCTLD': return toolPotLines();
    case 'TOLNI1': return toolOffsetLines(1);
    case 'TOLNM1': return toolOffsetLines(INCH_TO_MM);
    case 'MCRNI1':
    case 'MCRNM1': return macroLines(state);
    default: return [];
  }
}

/** Magazine pot list: pot 1 is key M02 in the ATCTL reply. */
function toolPotLines(): string[] {
  return Object.keys(TOOL_OFFSETS).map((tool, index) => `M${String(index + 2).padStart(2, '0')},${padLeft(Number(tool), 3)},0,0`);
}

function toolOffsetLines(unitScale: number): string[] {
  return Object.entries(TOOL_OFFSETS).map(([tool, offsets]) => {
    const length = (offsets.length * unitScale).toFixed(4);
    const diameter = (offsets.diameter * unitScale).toFixed(4);
    return `T${tool.padStart(2, '0')}, ${length}, 0.0000, ${diameter}, 0.0000, 0, 0, 0, 0, '${offsets.name.padEnd(8)}'`;
  });
}

/** Common macro variables #100-#105. #100 holds the part count, like many shops do. */
function macroLines(state: MachineState): string[] {
  const values = [state.partCount, state.partGoal, 0, 0, 0, 0];
  return values.map((value, index) => `C${100 + index}, ${value.toFixed(4)}`);
}

function checksum(body: string): string {
  const sum = [...body].reduce((total, char) => total + char.charCodeAt(0), 0);
  return String(sum % 16).padStart(2, '0');
}

function padLeft(value: number, width: number): string {
  return String(value).padStart(width, ' ');
}
