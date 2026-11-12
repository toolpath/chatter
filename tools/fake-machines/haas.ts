import net from 'net';
import type { MachineSimulator, MachineState, Mode } from './simulator.js';
import { startRequestReplyServer, type SlowStart } from './tcp.js';

/**
 * Fake Haas NGC control. It opens two ports, like the real control:
 *
 * - Data stream (9998): the client sends M_T_C_O_N_N_E_C_T_O_N, then the control pushes
 *   frames of "\x02<time>|key|value|key|value\n\x03". Haas does not document this port;
 *   the format copies real captures from a VF-6/40 (Ladder99 BetterHaasModel).
 * - Query port (5051): the client sends "?Q104\n" and the control answers ">MODE, MEM\r\n".
 *   Replies follow "27 - NGC - Machine Data Collection" in the Haas NGC service manual.
 */

const DATA_STREAM_INIT = 'M_T_C_O_N_N_E_C_T_O_N';
const FRAME_START = '\x02';
const FRAME_END = '\n\x03';
const PUSH_INTERVAL_MS = 1000;
/** Haas sends spindle rpm with 4 decimal places, as a whole number */
const RPM_SCALE = 10000;
/** Each query is one line that ends with a newline */
const QUERY_PATTERN = /([^\n]*)\n/g;

const PROGRAM_FOLDER = '/home/haas/UserData/Memory';
const MDI_PROGRAM = '/home/haas/.HaasData/MDI';

const HAAS_MODES: Record<Mode, string> = { MANUAL: 'JOG', MDI: 'MDI', MEMORY: 'MEM', EDIT: 'EDIT' };

export interface HaasPorts {
  dataPort: number;
  queryPort: number;
}

/** Only the query port starts slowly. The data stream sends by itself, at its own pace. */
export function startHaasServers(simulator: MachineSimulator, host: string, ports: HaasPorts, slowStart: SlowStart): net.Server[] {
  const answer = (query: string) => `>${answerQuery(query.trim(), simulator.getState())}\r\n`;
  return [
    startDataStream(simulator, host, ports.dataPort),
    startRequestReplyServer(host, ports.queryPort, QUERY_PATTERN, answer, slowStart),
  ];
}

function startDataStream(simulator: MachineSimulator, host: string, port: number): net.Server {
  const server = net.createServer(socket => {
    const pusher = new DataStreamPusher(socket, () => dataStreamFrame(simulator.getState()));
    socket.on('data', chunk => {
      if (chunk.toString('ascii').includes(DATA_STREAM_INIT)) pusher.start();
    });
    socket.on('close', () => pusher.stop());
    socket.on('error', () => { pusher.stop(); socket.destroy(); });
  });
  server.listen(port, host);
  return server;
}

/** Sends a new frame to one client every second, until the client goes away. */
class DataStreamPusher {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly socket: net.Socket, private readonly nextFrame: () => string) {}

  start(): void {
    if (this.timer) return;
    this.push();
    this.timer = setInterval(() => this.push(), PUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private push(): void {
    this.socket.write(this.nextFrame(), 'ascii');
  }
}

function dataStreamFrame(state: MachineState): string {
  const fields = [
    new Date().toISOString().replace('T', ' ').replace('Z', ''),
    'ActiveTool', state.toolNumber,
    'ProgramName', programPath(state),
    'SpindleActualRPM', state.spindleRpm * RPM_SCALE,
    'alarm0', state.alarm?.code ?? '0',
  ];
  return FRAME_START + fields.join('|') + FRAME_END;
}

/** Haas reports the full file path of the running program. */
function programPath(state: MachineState): string {
  return state.mode === 'MDI' ? MDI_PROGRAM : `${PROGRAM_FOLDER}/${state.program.name}.NC`;
}

/** Answer one Q command, for example "?Q500" or "?Q600 100". */
function answerQuery(query: string, state: MachineState): string {
  const [code, argument] = query.replace(/^\?/, '').split(/\s+/);
  switch (code.toUpperCase()) {
    case 'Q100': return 'SERIAL NUMBER, 1234567';
    case 'Q104': return `MODE, ${HAAS_MODES[state.mode]}`;
    case 'Q201': return `USED TOOLS, ${state.toolNumber}`;
    case 'Q301': return 'C.S. TIME, 00012:34:56';
    case 'Q402': return `M30 #1, ${state.partCount}`;
    case 'Q500': return runStatusReply(state);
    case 'Q600': return macroReply(Number(argument), state);
    default: return `?, ${query}`;
  }
}

/** A real control answers only "STATUS, BUSY" while a program runs */
function runStatusReply(state: MachineState): string {
  const status = programStatus(state);
  return status === 'BUSY' ? 'STATUS, BUSY' : `PROGRAM, ${state.program.name}, ${status}, PARTS, ${state.partCount}`;
}

function programStatus(state: MachineState): string {
  if (state.alarm) return 'ALARM ON';
  if (state.execution === 'ACTIVE') return 'BUSY';
  if (state.execution === 'INTERRUPTED') return 'FEED HOLD';
  return 'IDLE';
}

/** #100 holds the part count and #101 the part goal, as many shops set up. #1098 is the spindle load. */
function macroReply(location: number, state: MachineState): string {
  const values: Record<number, number> = { 100: state.partCount, 101: state.partGoal, 1098: state.spindleLoad };
  return `MACRO, ${(values[location] ?? 0).toFixed(6)}`;
}
