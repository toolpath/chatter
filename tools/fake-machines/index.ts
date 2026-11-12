import type { Server } from 'net';
import { networkInterfaces } from 'os';
import { startBrotherServer } from './brother.js';
import { addToChatter, loginFromEnvironment, PASSWORD_VARIABLE, USERNAME_VARIABLE } from './chatterApi.js';
import { startFtpServer } from './ftp.js';
import { startHaasServers } from './haas.js';
import { startMTConnectAgent } from './mtconnect.js';
import { hostsFor, type Hosts } from './network.js';
import { readOptions } from './options.js';
import { PROFILES, type MachineProfile } from './profiles.js';
import { ftpRootFor, prepareSampleFiles } from './sampleFiles.js';
import { MachineSimulator } from './simulator.js';
import { slowStartOf, type SlowStart } from './tcp.js';

/**
 * Start fake CNC machines on this computer so ChatterBox V2 has data to show.
 *
 *   npm run fake-machines                 start the machines
 *   npm run fake-machines -- --add        also add them to Chatter (needs CHATTER_USERNAME and CHATTER_PASSWORD)
 *   npm run fake-machines -- --speed 10   run 10 times faster than real time
 *   npm run fake-machines -- --lan        let other devices on the local network find them, like real machines
 *   npm run fake-machines -- --slow-start 0   answer at once; by default Brother and Haas answer slowly for 10 seconds after Chatter connects
 */

function startMachine(profile: MachineProfile, speed: number, host: string, slowStart: SlowStart): Server[] {
  const simulator = new MachineSimulator({ programs: profile.programs, alarms: profile.alarms, speed });
  simulator.start();
  return [...startControlServers(profile, simulator, host, slowStart), startFtpServer(ftpRootFor(profile.name), host, profile.ftpPort)];
}

/** A real MTConnect agent is a PC that answers at once, so only Brother and Haas start slowly */
function startControlServers(profile: MachineProfile, simulator: MachineSimulator, host: string, slowStart: SlowStart): Server[] {
  switch (profile.kind) {
    case 'brother': return [startBrotherServer(simulator, host, profile.port, slowStart)];
    case 'haas': return startHaasServers(simulator, host, profile, slowStart);
    case 'mtconnect': return [startMTConnectAgent(simulator, profile.identity, host, profile.port)];
  }
}

function portsOf(profile: MachineProfile): string {
  return profile.kind === 'haas' ? `${profile.dataPort} + ${profile.queryPort}` : String(profile.port);
}

function whereTheyAre(hosts: Hosts): string {
  return hosts.listen === hosts.machine
    ? `on ${hosts.machine} (only this computer)`
    : `on ${hosts.machine} (other devices on the local network can find them)`;
}

/** Make the sample programs of each machine, the first time it starts */
function prepareAllSampleFiles(): Promise<void[]> {
  return Promise.all(PROFILES.map(profile => prepareSampleFiles(ftpRootFor(profile.name), profile.programFolder, profile.programs)));
}

/** Add the machines to Chatter with the login from the environment variables. The machines run either way. */
async function addAllMachines(api: string, machineHost: string): Promise<void> {
  const login = loginFromEnvironment(process.env);
  if (!login) {
    console.error(`Not adding the machines: Chatter needs a login. Set ${USERNAME_VARIABLE} and ${PASSWORD_VARIABLE}, for example:`);
    console.error(`  ${USERNAME_VARIABLE}=admin ${PASSWORD_VARIABLE}='your password' npm run fake-machines -- --add`);
    return;
  }
  console.log(`Adding machines to Chatter at ${api}:`);
  await addToChatter(api, login, PROFILES, machineHost).catch(error => {
    console.error(`  Could not reach Chatter (${error.message}). Is "npm run dev" running?`);
  });
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const hosts = hostsFor(options.lan, networkInterfaces());
  await prepareAllSampleFiles();
  const slowStart = slowStartOf(options.slowStartSeconds);
  const servers = PROFILES.flatMap(profile => startMachine(profile, options.speed, hosts.listen, slowStart));
  servers.forEach(server => server.on('error', error => {
    console.error(`Could not open a port: ${error.message}`);
    process.exit(1);
  }));

  console.log(`Fake machines running at ${options.speed}x speed ${whereTheyAre(hosts)}:`);
  console.table(PROFILES.map(p => ({ machine: p.name, type: p.request.type, ports: portsOf(p), ftp: p.ftpPort })));

  if (options.add) await addAllMachines(options.api, hosts.machine);
  console.log('Press Ctrl+C to stop.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
