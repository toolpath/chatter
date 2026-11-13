/**
 * Bindings for the FANUC FOCAS2 library, which talks to FANUC CNC controls over Ethernet.
 *
 * Supported platforms:
 * - Linux x64 (libfwlib32-linux-x64.so.1.0.5)
 * - Linux ARM, 32-bit only (libfwlib32-linux-armv7.so.1.0.5)
 * - Windows x64 (Fwlib64.dll)
 */

import koffi from 'koffi';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { focasLibraryPath } from './focasLibraryPath.js';
import { FocasError } from './focasError.js';

/** The FOCAS return code for success. Every other code is in FOCAS_ERROR_MESSAGES. */
const EW_OK = 0;

const FOCAS_ERROR_MESSAGES: Record<number, string> = {
  [-17]: 'Protocol error',
  [-16]: 'Socket error',
  [-15]: 'DLL/SO file not found',
  [-11]: 'Bus error',
  [-10]: 'System error',
  [-9]: 'HSSB communication error',
  [-8]: 'Library handle error',
  [-7]: 'CNC/PMC version mismatch',
  [-6]: 'Abnormal error',
  [-5]: 'System error',
  [-4]: 'Shared RAM parity error',
  [-3]: 'Driver installation error',
  [-2]: 'Reset or stop occurred',
  [-1]: 'Busy',
  [0]: 'OK',
  [1]: 'Command prepare error',
  [2]: 'Data block length error',
  [3]: 'Data number error',
  [4]: 'Data attribute error',
  [5]: 'Data error',
  [6]: 'No option error',
  [7]: 'Write protect error',
  [8]: 'Memory overflow error',
  [9]: 'CNC parameter error',
  [10]: 'Buffer error',
  [11]: 'Path error',
  [12]: 'CNC mode error',
  [13]: 'Execution rejected',
  [14]: 'Data server error',
  [15]: 'Alarm occurred',
  [16]: 'CNC not running',
  [17]: 'Protection data error',
};

function errorText(code: number): string {
  return FOCAS_ERROR_MESSAGES[code] || String(code);
}

/** The ODBST.aut values of the 0i, 16i/18i/21i, 30i/31i/32i and Power Mate i controls. 2 is not used. */
const CNC_MODES: Record<number, string> = {
  0: 'MDI',
  1: 'MEMORY',
  3: 'EDIT',
  4: 'HANDLE',
  5: 'JOG',
  6: 'TEACH_JOG',
  7: 'TEACH_HANDLE',
  8: 'INCREMENT',
  9: 'REFERENCE',
  10: 'REMOTE',
};

const RUN_STATES: Record<number, string> = {
  0: 'RESET',
  1: 'STOP',
  2: 'HOLD',
  3: 'START',
  4: 'MSTR',  // Tape reading
};

export interface FocasStatus {
  mode: string;
  modeCode: number;
  runState: string;
  runStateCode: number;
  motion: number;
  mstb: number;
  emergency: boolean;
  alarm: boolean;
  edit: number;
}

/** The fields of ODBST that Chatter reads */
export interface OdbstReply {
  aut: number;
  run: number;
  motion: number;
  mstb: number;
  emergency: number;
  alarm: number;
  edit: number;
}

/** The machine status from the ODBST reply of cnc_statinfo */
export function toFocasStatus(reply: OdbstReply): FocasStatus {
  return {
    mode: CNC_MODES[reply.aut] || `UNKNOWN_${reply.aut}`,
    modeCode: reply.aut,
    runState: RUN_STATES[reply.run] || `UNKNOWN_${reply.run}`,
    runStateCode: reply.run,
    motion: reply.motion,
    mstb: reply.mstb,
    emergency: reply.emergency !== 0,
    alarm: reply.alarm !== 0,
    edit: reply.edit,
  };
}

export interface FocasMacro {
  number: number;
  value: number;
  decimalPlaces: number;
}

export interface FocasAlarm {
  alarmNo: number;
  type: number;
  axis: number;
  message: string;
}

export interface FocasProgram {
  name: string;
  number: number;
}

export interface FocasOperatorMessage {
  number: number;
  type: number;
  message: string;
}

export interface FocasSpindleSpeed {
  speed: number;
}

/** One meter of the cnc_rdspmeter reply (LOADELM) */
export interface LoadMeterReply {
  data: number;
  dec: number;
  unit: number;
}

/** The cnc_rdspmeter reply for one spindle (ODBSPLOAD) */
export interface SpindleMeterReply {
  spload: LoadMeterReply;
  spspeed: LoadMeterReply;
}

/** The LOADELM unit for percent */
const PERCENT_UNIT = 0;

/**
 * The spindle load in percent, from the number of spindles read and the first spindle's meters.
 * No spindle read (for example an analog spindle) or another unit gives undefined, not 0.
 */
export function toSpindleLoadPercent(spindlesRead: number, reply: SpindleMeterReply): number | undefined {
  if (spindlesRead < 1 || reply.spload.unit !== PERCENT_UNIT) return undefined;
  return reply.spload.data / Math.pow(10, reply.spload.dec);
}

// ============================================
// Library file
// ============================================

/** The folder for FOCAS files that come with the server, for people who run it from source */
const BUNDLED_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../native/focas');

/** The folder for a FOCAS file that an admin uploads in the web app. It is in the data folder, so it survives updates. */
let uploadFolder: string | null = null;

/** The uploaded file when it exists, else the file that comes with the server */
function getLibraryPath(): string {
  const bundled = focasLibraryPath(process.platform, process.arch, BUNDLED_FOLDER);
  if (!uploadFolder) return bundled;
  const uploaded = focasLibraryPath(process.platform, process.arch, uploadFolder);
  return fs.existsSync(uploaded) ? uploaded : bundled;
}

// ============================================
// Structures (layouts from fwlib32.h)
// ============================================

/**
 * The reply of cnc_statinfo for the 0i, 16i/18i/21i, 30i/31i/32i and Power Mate i controls (fwlib32.h).
 * Series 15 has another layout, which Chatter does not read.
 * Exported for the test of the field places.
 */
export const ODBST = koffi.struct('ODBST', {
  hdck: 'int16',      // Manual handle re-trace status
  tmmode: 'int16',    // T or M mode
  aut: 'int16',       // Automatic or manual mode
  run: 'int16',       // Automatic operation status
  motion: 'int16',    // Axis movement and dwell status
  mstb: 'int16',      // M, S, T, B function status
  emergency: 'int16', // Emergency stop status
  alarm: 'int16',     // Alarm status
  edit: 'int16',      // Program editing status
});

const ODBACT = koffi.struct('ODBACT', {
  dummy: koffi.array('int16', 2),
  data: 'int32',      // Actual feed/spindle value
});

/** One meter of the cnc_rdspmeter reply (fwlib32.h). Exported for the test of the field places. */
export const LOADELM = koffi.struct('LOADELM', {
  data: 'int32',      // The meter value (a long, read as 32 bits as for ODBACT)
  dec: 'int16',       // Decimal places of data
  unit: 'int16',      // 0 = percent
  name: 'char',       // Spindle name, for example 'S'
  suff1: 'char',      // Spindle name suffix, for example '1'
  suff2: 'char',
  reserve: 'char',
});

/** The cnc_rdspmeter reply for one spindle. Exported for the test of the field places. */
export const ODBSPLOAD = koffi.struct('ODBSPLOAD', {
  spload: LOADELM,    // Spindle load meter
  spspeed: LOADELM,   // Spindle speed meter
});

const ODBM = koffi.struct('ODBM', {
  datano: 'int16',    // Variable number
  dummy: 'int16',
  mcr_val: 'int32',   // Macro variable value, as a whole number
  dec_val: 'int16',   // Decimal places of mcr_val
});

/** The length that FANUC gives for ODBM in a cnc_rdmacro call (without the padding at the end) */
const ODBM_LENGTH = 10;

const ODBEXEPRG = koffi.struct('ODBEXEPRG', {
  name: koffi.array('char', 36),  // Program name
  o_num: 'int32',                  // Program number
});

const ODBALMMSG_DATA = koffi.struct('ODBALMMSG_DATA', {
  alm_no: 'int32',
  type: 'int16',
  axis: 'int16',
  dummy: 'int16',
  msg_len: 'int16',
  alm_msg: koffi.array('char', 32),
});

const OPMSG3_DATA = koffi.struct('OPMSG3_DATA', {
  datano: 'int16',
  type: 'int16',
  char_num: 'int16',
  data: koffi.array('char', 256),
});

const MAX_ALARMS = 10;
const MAX_OPERATOR_MESSAGES = 5;

/** The fields msg1, msg2, ... of a FOCAS reply that holds several messages */
function numberedMessageFields(messageType: koffi.IKoffiCType, count: number): Record<string, koffi.IKoffiCType> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`msg${i + 1}`, messageType]));
}

const ODBALMMSG = koffi.struct('ODBALMMSG', numberedMessageFields(ODBALMMSG_DATA, MAX_ALARMS));
const OPMSG3 = koffi.struct('OPMSG3', numberedMessageFields(OPMSG3_DATA, MAX_OPERATOR_MESSAGES));

/** Koffi gives a char array as a string, a Uint8Array or a number array */
type KoffiChars = Uint8Array | number[] | string;

interface AlarmMessageReply {
  alm_no: number;
  type: number;
  axis: number;
  msg_len: number;
  alm_msg: KoffiChars;
}

interface OperatorMessageReply {
  datano: number;
  type: number;
  char_num: number;
  data: KoffiChars;
}

/** The first `count` entries (msg1, msg2, ...) of a reply built with numberedMessageFields */
function numberedMessages<Message>(reply: object, count: number): Message[] {
  const fields = reply as Record<string, Message | undefined>;
  return Array.from({ length: count }, (_, i) => fields[`msg${i + 1}`])
    .filter((message): message is Message => Boolean(message));
}

/** A FOCAS char array as text, without the NUL bytes and the spaces at the ends */
function charsToString(chars: KoffiChars, maxLength?: number): string {
  if (typeof chars === 'string') {
    return chars.substring(0, maxLength).replace(/\0/g, '').trim();
  }
  if (chars instanceof Uint8Array || Buffer.isBuffer(chars)) {
    return Buffer.from(chars).toString('utf8', 0, maxLength).replace(/\0/g, '').trim();
  }
  if (Array.isArray(chars)) {
    return String.fromCharCode(...chars.slice(0, maxLength).filter(c => c !== 0)).trim();
  }
  return String(chars).replace(/\0/g, '').trim();
}

// ============================================
// Library functions
// ============================================

/** The cnc_* functions that Chatter calls. Each returns a FOCAS return code. */
interface FocasFunctions {
  allclibhndl3: (ip: string, port: number, timeoutSeconds: number, handle: number[]) => number;
  freelibhndl: (handle: number) => number;
  statinfo: (handle: number, status: object) => number;
  acts: (handle: number, speed: object) => number;
  rdspmeter: (handle: number, type: number, count: number[], meters: object) => number;
  rdmacro: (handle: number, number: number, length: number, macro: object) => number;
  exeprgname: (handle: number, program: object) => number;
  rdalmmsg: (handle: number, type: number, length: number[], alarms: object) => number;
  rdopmsg3: (handle: number, type: number, length: number[], messages: object) => number;
}

function declareFunctions(library: koffi.IKoffiLib): FocasFunctions {
  const readMessages = (name: string, reply: koffi.IKoffiCType) =>
    library.func(name, 'int16', ['uint16', 'int16', koffi.inout(koffi.pointer('int16')), koffi.out(koffi.pointer(reply))]);
  return {
    allclibhndl3: library.func('cnc_allclibhndl3', 'int16', ['str', 'uint16', 'int32', koffi.out(koffi.pointer('uint16'))]),
    freelibhndl: library.func('cnc_freelibhndl', 'int16', ['uint16']),
    statinfo: library.func('cnc_statinfo', 'int16', ['uint16', koffi.out(koffi.pointer(ODBST))]),
    acts: library.func('cnc_acts', 'int16', ['uint16', koffi.out(koffi.pointer(ODBACT))]),
    rdspmeter: library.func('cnc_rdspmeter', 'int16', ['uint16', 'int16', koffi.inout(koffi.pointer('int16')), koffi.out(koffi.pointer(ODBSPLOAD))]),
    rdmacro: library.func('cnc_rdmacro', 'int16', ['uint16', 'int16', 'int16', koffi.out(koffi.pointer(ODBM))]),
    exeprgname: library.func('cnc_exeprgname', 'int16', ['uint16', koffi.out(koffi.pointer(ODBEXEPRG))]),
    rdalmmsg: readMessages('cnc_rdalmmsg', ODBALMMSG),
    rdopmsg3: readMessages('cnc_rdopmsg3', OPMSG3),
  };
}

/** Where the Linux library writes its log */
const LINUX_LOG_FILE = '/tmp/focas2.log';

/** The Linux library must start its process before any other call */
function startLinuxProcess(library: koffi.IKoffiLib): void {
  const startupProcess = library.func('cnc_startupprocess', 'int16', ['int64', 'str']);
  const result = startupProcess(0, LINUX_LOG_FILE);
  if (result !== EW_OK) {
    throw new Error(`FOCAS startup failed: ${errorText(result)}`);
  }
}

/**
 * The function that ends the Linux FOCAS process. Each thread declares it, because the thread
 * that ends the process at shutdown need not be the one that started it.
 */
function declareExitProcess(library: koffi.IKoffiLib): () => number {
  return library.func('cnc_exitprocess', 'int16', []);
}

let library: koffi.IKoffiLib | null = null;
/** Set only while the library is loaded and started */
let functions: FocasFunctions | null = null;
let exitLinuxProcess: (() => number) | null = null;

function unloadLibrary(): void {
  library?.unload();
  library = null;
}

function loadedFunctions(): FocasFunctions {
  if (!functions) throw new Error('FOCAS library not properly initialized');
  return functions;
}

function throwIfFailed(result: number, action: string): void {
  if (result !== EW_OK) {
    throw new FocasError(`Failed to ${action}: ${errorText(result)}`, result);
  }
}

/** Ask cnc_rdalmmsg and cnc_rdopmsg3 for messages of every type */
const ALL_TYPES = -1;
/** The cnc_rdspmeter type for the load meter */
const LOAD_METER = 0;
/** cnc_rdspmeter reads this many spindles, and then says how many it read */
const SPINDLES_TO_READ = 1;

// ============================================
// FOCAS class
// ============================================

/**
 * The FOCAS library and one connection to a control.
 * The cnc_* calls block until the control answers, so only the FOCAS thread (focasWorker.ts) makes them.
 * The rest of the server uses FocasThread. The static methods that only look at files work on any thread.
 */
export class Focas {
  private handle = 0;
  private isConnected = false;

  /**
   * Load and start the FOCAS library. A library that is loaded already stays.
   * On Linux, startProcess also calls cnc_startupprocess. That process is for the whole server,
   * so when each machine has its own FOCAS thread, only the first thread starts it (see FocasThreads).
   */
  static initialize(libraryPath: string = getLibraryPath(), startProcess = true): void {
    if (functions) return;

    try {
      library = koffi.load(libraryPath);
      const declared = declareFunctions(library);
      if (process.platform === 'linux') {
        if (startProcess) startLinuxProcess(library);
        exitLinuxProcess = declareExitProcess(library);
      }
      functions = declared;
    } catch (error) {
      unloadLibrary();
      if (error instanceof Error && error.message.includes('macOS')) {
        throw error;
      }
      throw new Error(`Failed to initialize FOCAS library: ${error}`);
    }
  }

  /**
   * Unload the library, when the server shuts down. On Linux, exitProcess also calls cnc_exitprocess,
   * which ends the FOCAS process of the whole server, so only the last thread to clean up asks for it.
   */
  static cleanup(exitProcess = true): void {
    if (!functions) return;
    if (exitProcess) exitLinuxProcess?.();
    exitLinuxProcess = null;
    functions = null;
    unloadLibrary();
  }

  /** Look for an uploaded FOCAS file in this folder first */
  static useUploadFolder(folder: string): void {
    uploadFolder = folder;
  }

  /** Where an uploaded FOCAS file for this computer goes. Throws when FANUC makes no library for this computer. */
  static uploadPath(): string {
    if (!uploadFolder) throw new Error('No folder for uploaded FOCAS files is set.');
    return focasLibraryPath(process.platform, process.arch, uploadFolder);
  }

  /** The FOCAS file that Chatter uses: the uploaded one when it exists. Throws when FANUC makes no library for this computer. */
  static libraryPath(): string {
    return getLibraryPath();
  }

  /** True when the library is in memory and started */
  static isLoaded(): boolean {
    return functions !== null;
  }

  /**
   * True when FOCAS is supported on this platform and the FANUC library file is installed.
   * The library files are not part of this repo (see apps/server/native/focas/README.md).
   */
  static isAvailable(): boolean {
    try {
      return fs.existsSync(getLibraryPath());
    } catch {
      return false;
    }
  }

  /** Why FOCAS is or is not available on this computer */
  static getPlatformMessage(): string {
    let libPath: string;
    try {
      libPath = getLibraryPath();
    } catch (err) {
      return err instanceof Error ? err.message : 'FOCAS is not available on this platform.';
    }
    if (!fs.existsSync(libPath)) {
      return `FOCAS library not found at ${libPath}. See apps/server/native/focas/README.md.`;
    }
    return `FOCAS is available for ${process.platform}/${process.arch}`;
  }

  /** Initialize must have loaded the library */
  connect(host: string, port: number, timeoutSeconds: number): void {
    if (this.isConnected) {
      this.disconnect();
    }

    const handleOut = [0];
    const result = loadedFunctions().allclibhndl3(host, port, timeoutSeconds, handleOut);
    if (result !== EW_OK) {
      throw new FocasError(`Connection failed: ${FOCAS_ERROR_MESSAGES[result] || `Error code ${result}`}`, result);
    }

    this.handle = handleOut[0];
    this.isConnected = true;
  }

  disconnect(): void {
    if (!this.isConnected || !functions) return;

    functions.freelibhndl(this.handle);
    this.handle = 0;
    this.isConnected = false;
  }

  readStatus(): FocasStatus {
    const status = {};
    throwIfFailed(this.connectedFunctions().statinfo(this.handle, status), 'read status');
    return toFocasStatus(status as OdbstReply);
  }

  readSpindleSpeed(): FocasSpindleSpeed {
    const speed = {};
    throwIfFailed(this.connectedFunctions().acts(this.handle, speed), 'read spindle speed');
    return { speed: (speed as { data: number }).data };
  }

  /**
   * Read the load of the first spindle in percent (cnc_rdspmeter, load meter).
   * It needs a serial (FANUC digital) spindle. It gives undefined when the control reads no spindle.
   */
  readSpindleLoad(): number | undefined {
    const meters = {};
    const spindlesRead = [SPINDLES_TO_READ];
    throwIfFailed(this.connectedFunctions().rdspmeter(this.handle, LOAD_METER, spindlesRead, meters), 'read spindle load');
    return toSpindleLoadPercent(spindlesRead[0], meters as SpindleMeterReply);
  }

  /** Read a custom macro variable */
  readMacro(macroNumber: number): FocasMacro {
    const macro = {};
    throwIfFailed(this.connectedFunctions().rdmacro(this.handle, macroNumber, ODBM_LENGTH, macro), `read macro ${macroNumber}`);

    const reply = macro as { datano: number; mcr_val: number; dec_val: number };
    return {
      number: reply.datano,
      value: reply.mcr_val / Math.pow(10, reply.dec_val),
      decimalPlaces: reply.dec_val,
    };
  }

  /** Read the program that runs now */
  readProgram(): FocasProgram {
    const program = {};
    throwIfFailed(this.connectedFunctions().exeprgname(this.handle, program), 'read program');

    const reply = program as { name: KoffiChars; o_num: number };
    return { name: charsToString(reply.name), number: reply.o_num };
  }

  readAlarms(): FocasAlarm[] {
    const alarms = {};
    const length = [MAX_ALARMS];
    throwIfFailed(this.connectedFunctions().rdalmmsg(this.handle, ALL_TYPES, length, alarms), 'read alarms');

    return numberedMessages<AlarmMessageReply>(alarms, length[0])
      .filter(alarm => alarm.alm_no !== 0)
      .map(alarm => ({
        alarmNo: alarm.alm_no,
        type: alarm.type,
        axis: alarm.axis,
        message: charsToString(alarm.alm_msg, alarm.msg_len),
      }));
  }

  /** Read the operator messages. A control that does not support cnc_rdopmsg3 throws, as for the other reads. */
  readOperatorMessages(): FocasOperatorMessage[] {
    const messages = {};
    const length = [MAX_OPERATOR_MESSAGES];
    throwIfFailed(this.connectedFunctions().rdopmsg3(this.handle, ALL_TYPES, length, messages), 'read operator messages');

    return numberedMessages<OperatorMessageReply>(messages, length[0])
      .filter(message => message.char_num > 0)
      .map(message => ({
        number: message.datano,
        type: message.type,
        message: charsToString(message.data, message.char_num),
      }))
      .filter(message => message.message !== '');
  }

  private connectedFunctions(): FocasFunctions {
    if (!this.isConnected) {
      throw new Error('Not connected to CNC controller');
    }
    return loadedFunctions();
  }
}
