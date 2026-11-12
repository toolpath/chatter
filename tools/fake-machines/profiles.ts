import type { AddMachineRequest } from '@local-chatter/shared';
import type { Alarm } from './simulator.js';
import type { AgentIdentity } from './mtconnect.js';
import { HEAVY_PROGRAMS, HIGH_SPEED_PROGRAMS, type Program } from './programs.js';

/**
 * One fake machine: what it runs, what alarms it can show,
 * which ports it opens, and how ChatterBox V2 should add it.
 */

interface BaseProfile {
  name: string;
  programs: Program[];
  alarms: Alarm[];
  /** The fake FTP server port. Real machines use 21, but the fakes share one computer. */
  ftpPort: number;
  /** The folder on the FTP server for the sample programs ('' is the top folder) */
  programFolder: string;
  /** The body sent to POST /api/machines, without the address. machineRequest() adds it. */
  request: Omit<AddMachineRequest, 'host'>;
}

export interface BrotherProfile extends BaseProfile { kind: 'brother'; port: number }
export interface HaasProfile extends BaseProfile { kind: 'haas'; dataPort: number; queryPort: number }
export interface MTConnectProfile extends BaseProfile { kind: 'mtconnect'; port: number; identity: AgentIdentity }

export type MachineProfile = BrotherProfile | HaasProfile | MTConnectProfile;

/** Brother codes: two-digit category (03 = servo, 06 = spindle, 01 = external) then the number */
const BROTHER_ALARMS: Alarm[] = [
  { code: '0300000005', text: 'SV0005 Z axis servo overload' },
  { code: '0600000009', text: 'SP0009 Spindle overload' },
  { code: '0100000001', text: 'EX0001 Air pressure low' },
];

/** Haas NGC codes (axis.alarm), from the Haas alarm search page */
const HAAS_ALARMS: Alarm[] = [
  { code: '1.108', text: 'X AXIS SERVO OVERLOAD' },
  { code: '3.108', text: 'Z AXIS SERVO OVERLOAD' },
];

/** Okuma OSP-P300 Alarm-A list */
const OKUMA_ALARMS: Alarm[] = [
  { code: '1700', text: 'Emergency stop', emergencyStop: true },
];

/** DMU 50 uses a Siemens SINUMERIK control */
const DMG_ALARMS: Alarm[] = [
  { code: '3000', text: 'EMERGENCY STOP', emergencyStop: true },
];

/** The body for POST /api/machines: the machine at `host` */
export function machineRequest(profile: MachineProfile, host: string): AddMachineRequest {
  return { ...profile.request, host };
}

export const PROFILES: MachineProfile[] = [
  {
    kind: 'brother',
    name: 'Fake Brother Speedio',
    port: 10000,
    programs: HIGH_SPEED_PROGRAMS,
    alarms: BROTHER_ALARMS,
    ftpPort: 2121,
    programFolder: '',
    request: { type: 'brother', name: 'Fake Brother Speedio', dataPort: 10000, ftpPort: 2121 },
  },
  {
    kind: 'haas',
    name: 'Fake Haas VF-2',
    dataPort: 9998,
    queryPort: 5051,
    programs: HEAVY_PROGRAMS,
    alarms: HAAS_ALARMS,
    ftpPort: 2122,
    programFolder: 'My Programs',
    request: {
      type: 'haas', name: 'Fake Haas VF-2', dataPort: 9998, queryPort: 5051, ftpPort: 2122,
    },
  },
  {
    kind: 'mtconnect',
    name: 'Fake Okuma Genos',
    port: 5000,
    programs: HEAVY_PROGRAMS,
    alarms: OKUMA_ALARMS,
    ftpPort: 2123,
    programFolder: 'MD1',
    identity: {
      deviceId: 'okuma', deviceName: 'OKUMA', uuid: 'fake-okuma-0001',
      manufacturer: 'OKUMA', model: 'GENOS M560-V',
    },
    request: { type: 'mtconnect', name: 'Fake Okuma Genos', mtConnectPort: 5000, agentType: 'generic', ftpPort: 2123 },
  },
  {
    kind: 'mtconnect',
    name: 'Fake DMG Mori DMU 50',
    port: 5001,
    programs: HIGH_SPEED_PROGRAMS,
    alarms: DMG_ALARMS,
    ftpPort: 2124,
    programFolder: 'Part programs',
    identity: {
      deviceId: 'dmg', deviceName: 'DMU50', uuid: 'fake-dmg-0001',
      manufacturer: 'DMG MORI', model: 'DMU 50',
    },
    request: { type: 'mtconnect', name: 'Fake DMG Mori DMU 50', mtConnectPort: 5001, agentType: 'dmg_mori', ftpPort: 2124 },
  },
];
