import { describe, expect, it } from 'vitest';
import { agentTypeOf, devicesOfProbe, foundMTConnectMachine, haasSerialOf, maybeFanuc } from './askMachines.js';

const probe = (devices: string) => `<?xml version="1.0"?>
<MTConnectDevices xmlns="urn:mtconnect.org:MTConnectDevices:1.3"><Header/><Devices>${devices}</Devices></MTConnectDevices>`;

const okuma = '<Device id="okuma" name="OKUMA" uuid="u1"><Description manufacturer="OKUMA" model="GENOS M560-V"/></Device>';
const plain = '<Device id="d2" name="Mill2" uuid="u2"/>';

describe('haasSerialOf', () => {
  it('reads the serial number from a Q100 reply', () => {
    expect(haasSerialOf('>SERIAL NUMBER, 1234567\r\n')).toBe('1234567');
  });

  it('gives null for any other reply', () => {
    expect(haasSerialOf('>?, ?Q100\r\n')).toBeNull();
    expect(haasSerialOf('HTTP/1.1 400 Bad Request\r\n')).toBeNull();
  });
});

describe('agentTypeOf', () => {
  it('finds the agent type in the maker name', () => {
    expect(agentTypeOf('DMG MORI')).toBe('dmg_mori');
    expect(agentTypeOf('Okuma Corporation')).toBe('okuma');
    expect(agentTypeOf('Acme')).toBe('generic');
    expect(agentTypeOf(undefined)).toBe('generic');
  });
});

describe('devicesOfProbe', () => {
  it('lists each device with its maker and model', async () => {
    expect(await devicesOfProbe(probe(okuma + plain))).toEqual([
      { id: 'okuma', name: 'OKUMA', manufacturer: 'OKUMA', model: 'GENOS M560-V' },
      { id: 'd2', name: 'Mill2', manufacturer: undefined, model: undefined },
    ]);
  });

  it('reads tags with a namespace prefix', async () => {
    const xml = '<m:MTConnectDevices xmlns:m="urn:x"><m:Devices><m:Device id="a" name="A"/></m:Devices></m:MTConnectDevices>';
    expect((await devicesOfProbe(xml)).map(device => device.id)).toEqual(['a']);
  });
});

describe('foundMTConnectMachine', () => {
  it('names the machine by maker and model, and needs no device ID for one device', async () => {
    const found = foundMTConnectMachine('10.0.0.5', 5001, await devicesOfProbe(probe(okuma)));
    expect(found?.machine).toEqual({ type: 'mtconnect', name: 'OKUMA GENOS M560-V', host: '10.0.0.5', mtConnectPort: 5001, agentType: 'okuma' });
  });

  it('takes the first device and its ID when the agent has more than one', async () => {
    const found = foundMTConnectMachine('10.0.0.5', 5000, await devicesOfProbe(probe(okuma + plain)));
    expect(found?.machine.mtConnectDeviceId).toBe('okuma');
    expect(found?.detail).toContain('2 machines');
  });

  it('gives null when the agent has no device', () => {
    expect(foundMTConnectMachine('10.0.0.5', 5000, [])).toBeNull();
  });
});

describe('maybeFanuc', () => {
  it('is not confirmed, because Chatter cannot ask without the FOCAS library', () => {
    expect(maybeFanuc('10.0.0.7')).toMatchObject({ isConfirmed: false, machine: { type: 'fanuc', focasPort: 8193 } });
  });
});
