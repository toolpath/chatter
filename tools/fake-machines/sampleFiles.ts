import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Program } from './programs.js';

/** Each fake machine keeps its FTP files here. Git ignores this folder. */
const FILES_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.ftp-files');

/** The folder on this computer for one machine's FTP files */
export function ftpRootFor(machineName: string): string {
  return path.join(FILES_ROOT, machineName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}

/** A short G-code program that does the same steps as the fake machine */
export function gCodeOf(program: Program): string {
  const steps = program.steps.flatMap((step, index) => [
    `N${index + 1} T${step.toolNumber} M06`,
    `S${step.spindleRpm} M03`,
    `G04 P${step.seconds}.`,
  ]);
  return ['%', `${program.name} (SAMPLE PROGRAM FROM THE CHATTER FAKE MACHINES)`, ...steps, 'M05', 'M30', '%', ''].join('\r\n');
}

/**
 * Put the sample programs in the machine's FTP folder, the first time it starts.
 * Later starts keep the files, so uploads and deletes stay.
 */
export async function prepareSampleFiles(root: string, programFolder: string, programs: Program[]): Promise<void> {
  if (existsSync(root)) return;
  const folder = path.join(root, programFolder);
  await fs.mkdir(folder, { recursive: true });
  await Promise.all(programs.map(program => fs.writeFile(path.join(folder, `${program.name}.NC`), gCodeOf(program))));
}
