// Tests for the guardrails in AGENTS.md. Each test names the rule that it keeps.
// These rules protect users in the field, so a failure here blocks a change.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { networksOf, type ComposeServiceNetworks } from './composeNetworks';
import { interpolate, portsOpened, variableInPorts, variablesIn, type ComposePort, type OpenedPorts } from './composePorts';
import { anchorsOf, docsLinksIn, docsPageFile, headingLinksIn } from './docsLinks';

const ROOT = join(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const trackedFiles = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);

interface ComposeService {
  cap_add?: string[];
  cap_drop?: string[];
  command?: string[];
  container_name?: string;
  networks?: ComposeServiceNetworks | null;
  network_mode?: string;
  pids_limit?: number;
  ports?: ComposePort[];
  privileged?: boolean;
  security_opt?: string[];
  user?: string;
  volumes?: (string | { source?: string })[];
}
interface ComposeFile {
  name?: string;
  networks?: Record<string, { internal?: boolean } | null>;
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}
// Docker Compose merges a YAML merge key ("<<: *anchor"), so the tests merge it too.
const parseCompose = (text: string) => parse(text, { merge: true }) as ComposeFile;
const compose = (path: string) => parseCompose(read(path));
// Docker Compose also reads compose.yaml and compose.override.yml.
const composeFiles = trackedFiles().filter(file => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(file));
// The files that Docker Compose merges with docker-compose.yml. docker-compose.dev.yml is a different project
// (chatter-dev), so it is not in this list.
const mergedFiles = composeFiles.filter(file => !['docker-compose.yml', 'docker-compose.dev.yml'].includes(file));

describe('FANUC files', () => {
  it('are not in git, because the FOCAS2 library belongs to FANUC', () => {
    const fanucFiles = trackedFiles().filter(file => /(^|\/)(fwlib[^/]*|libfwlib32[^/]*)$/i.test(file));
    expect(fanucFiles).toEqual([]);
  });

  it('stay out of git through .gitignore', () => {
    expect(read('.gitignore')).toContain('apps/server/native/focas/**');
  });
});

describe('user data', () => {
  // Docker Compose puts the project name before each volume name: chatter_chatterbox-data.
  // A different project name or volume name makes an update lose the user's data.
  const main = compose('docker-compose.yml');

  it('keeps the volume names in docker-compose.yml', () => {
    expect(Object.keys(main.volumes ?? {})).toEqual(
      expect.arrayContaining(['chatterbox-data', 'victoriametrics-data', 'chatter-alert-rules']),
    );
    expect(main.services.chatterbox.volumes).toContain('chatterbox-data:/app/data');
    expect(main.services.victoriametrics.volumes).toContain('victoriametrics-data:/storage');
  });

  it('lets the folder name set the project name in docker-compose.yml', () => {
    expect(main.name).toBeUndefined();
  });

  it('keeps one folder, "chatter", in the zip of the Docker package', () => {
    // The last word of the zip command is the folder that goes into the zip
    const zipCommands = [...read('tools/release/make-docker-package.sh').matchAll(/\bzip\s+-[^\n]*/g)].map(([line]) => line);
    expect(zipCommands).toHaveLength(1);
    expect(zipCommands[0].replace(/[)\s]+$/, '').split(/\s+/).at(-1)).toBe('chatter');
  });

  it('keeps the folder /opt/chatter on the Pi card', () => {
    expect(read('tools/pi-image/in-pi/chatter.service')).toContain('WorkingDirectory=/opt/chatter');
  });
});

describe('closed ports', () => {
  // VictoriaMetrics (8428), vmalert (8880) and the alert port (3002) have no login.
  const noLoginPorts = [8428, 8880, 3002];
  // Docker Compose accepts only an IP address as the host address, so "localhost" is not in this list.
  const thisComputerOnly = ['127.0.0.1', '::1'];
  it('finds the compose files', () => {
    // A new compose file makes this test fail. Then add it here, and to mergedFiles if Docker Compose merges it.
    expect([...composeFiles].sort()).toEqual([
      'docker-compose.build.yml',
      'docker-compose.dev.yml',
      'docker-compose.yml',
      'tools/pi-image/in-pi/docker-compose.override.yml',
    ]);
  });

  // A user can set a variable of a port in a ".env" file, to any text. So a variable may set only the host address:
  // the host port and the container port must be plain text in the file. The tests also read each port with the
  // variables not set, empty, and set to an address or to a hostile value, one at a time and all together.
  // A variable syntax that the test cannot read makes the test fail.
  const portsOf = (file: string) =>
    Object.entries(compose(file).services ?? {}).flatMap(([service, { ports = [] }]) => ports.map(port => ({ service, port })));
  const networkAddress = '192.0.2.10';
  const values = [
    '',
    networkAddress,
    '[2001:db8::1]',
    '0.0.0.0:8428:8428',
    '0.0.0.0:3002:3002/udp',
    '1.2.3.4/udp',
    '1.2.3.4,5',
    '127.0.0.1:3002:3002,8428',
    'a b',
    '1.2.3.4\n- 3002:3002',
  ];
  const environmentsOf = (port: ComposePort) => {
    const names = variablesIn(JSON.stringify(port));
    const all = (value: string) => Object.fromEntries(names.map(name => [name, value]));
    const oneSet = (value: string) => names.map(name => ({ [name]: value }));
    return [{}, ...values.flatMap(value => [all(value), ...oneSet(value)])];
  };
  const sameContainerPorts = (a: OpenedPorts, b: OpenedPorts) => JSON.stringify(a.containerPorts) === JSON.stringify(b.containerPorts);
  const withVariables = (file: string) => portsOf(file).filter(({ port }) => variablesIn(JSON.stringify(port)).length > 0);
  const named = ({ service, port }: { service: string; port: ComposePort }) => `${service}: ${JSON.stringify(port)}`;

  it.each(composeFiles)('uses a variable in a port of %s only for the host address', file => {
    const inPorts = withVariables(file).filter(({ port }) => variableInPorts(port));
    expect(inPorts.map(named)).toEqual([]);

    const notOnlyAddress = withVariables(file).filter(({ port }) => {
      const unset = portsOpened(port);
      const set = portsOpened(port, Object.fromEntries(variablesIn(JSON.stringify(port)).map(name => [name, networkAddress])));
      return set.hostIp !== networkAddress || environmentsOf(port).some(environment => !sameContainerPorts(portsOpened(port, environment), unset));
    });
    expect(notOnlyAddress.map(named)).toEqual([]);
  });

  it('publishes no port of VictoriaMetrics or vmalert in docker-compose.yml', () => {
    const { services } = compose('docker-compose.yml');
    expect(services.victoriametrics.ports).toBeUndefined();
    expect(services.vmalert.ports).toBeUndefined();
  });

  it.each(composeFiles)('publishes a port with no login in %s only to this computer, with and without the variables', file => {
    const opened = portsOf(file)
      .filter(({ port }) =>
        environmentsOf(port)
          .map(environment => portsOpened(port, environment))
          .some(({ hostIp, containerPorts }) => !thisComputerOnly.includes(hostIp) && containerPorts.some(p => noLoginPorts.includes(p))),
      )
      .map(named);
    expect(opened).toEqual([]);
  });
});

describe('history network', () => {
  // VictoriaMetrics and vmalert have no login. On an internal network, no other computer on the shop network can reach
  // them, also with a Docker Engine older than 28, and they cannot connect out. Only Chatter is on both networks.
  const main = compose('docker-compose.yml');
  const networksOfService = (service: string) => networksOf(main.services[service] ?? {});
  const isInternal = (network: string) => main.networks?.[network]?.internal === true;

  it('makes the network "history" internal in docker-compose.yml', () => {
    expect(main.networks?.history?.internal).toBe(true);
  });

  it.each(['victoriametrics', 'vmalert'])('puts %s on "history" and on no network that is not internal', service => {
    expect(networksOfService(service)).toContain('history');
    expect(networksOfService(service).filter(network => !isInternal(network))).toEqual([]);
  });

  it('puts each service except chatterbox only on internal networks', () => {
    // A new service with no "networks:" is on "default", so this test fails until it gets a network.
    const exposed = Object.keys(main.services)
      .filter(service => service !== 'chatterbox')
      .filter(service => networksOfService(service).some(network => !isInternal(network)));
    expect(exposed).toEqual([]);
  });

  it('puts chatterbox on "default", for the browsers and the machines, and on "history"', () => {
    expect(networksOfService('chatterbox')).toEqual(expect.arrayContaining(['default', 'history']));
  });

  it('keeps "default" not internal, so the browsers reach port 3001 and Chatter reaches the machines', () => {
    expect(isInternal('default')).toBe(false);
  });

  // Docker Compose adds the "networks:" of a file that it merges with docker-compose.yml to the networks of
  // docker-compose.yml.

  it('finds the files that Docker Compose merges with docker-compose.yml', () => {
    expect(mergedFiles).toEqual(
      expect.arrayContaining(['docker-compose.build.yml', 'tools/pi-image/in-pi/docker-compose.override.yml']),
    );
  });

  it.each(mergedFiles)('adds no network in %s, so the networks of docker-compose.yml apply', file => {
    const merged = compose(file);
    const withNetworks = Object.entries(merged.services ?? {})
      .filter(([, service]) => 'networks' in service || 'network_mode' in service)
      .map(([service]) => service);
    expect(withNetworks).toEqual([]);
    expect(merged.networks).toBeUndefined();
  });
});

describe('container privileges', () => {
  // A program that takes control of a container (for example through a bad FOCAS library or a bug in node-opcua)
  // must not get more rights than the container uses. Chatter, VictoriaMetrics and vmalert need no Linux capability:
  // they open only ports above 1024. Each one writes only files that it owns, and reads only files that it owns or that
  // all users can read. VictoriaMetrics runs as root and made each file in its volume, also in an old volume.
  // What the settings stop:
  // - chatterbox runs as the user node. With no-new-privileges and no capabilities, a setuid program (for example su
  //   or mount) does not give it root.
  // - VictoriaMetrics and vmalert run as root. Without capabilities, root in them cannot ignore the rights of a file,
  //   and cannot send false packets on the network "history" (for example to change the alerts to chatterbox:3002,
  //   or the history that Chatter writes).
  const main = compose('docker-compose.yml');
  const services = Object.entries(main.services);
  // The lowest and the highest pids_limit. Below the lowest, a busy Chatter could not start a thread.
  // "0" and "-1" mean no limit. No test measures the threads: the hardware check in the pull request does.
  const fewestPids = 64;
  const mostPids = 1024;
  // Settings that give a container more rights, or access to the processes, devices or kernel settings of the computer.
  // deploy can set a pids limit too (deploy.resources.limits.pids).
  const hostAccessKeys = ['cap_add', 'cgroup', 'deploy', 'device_cgroup_rules', 'devices', 'ipc', 'pid', 'privileged', 'sysctls', 'userns_mode'];
  // Docker Compose adds the cap_add and security_opt of a merged file to those of docker-compose.yml,
  // and the other settings of a merged file replace those of docker-compose.yml.
  const privilegeKeys = [...hostAccessKeys, 'cap_drop', 'pids_limit', 'security_opt', 'user'];
  const privilegesChangedIn = (file: ComposeFile) =>
    Object.entries(file.services ?? {}).flatMap(([name, service]) =>
      privilegeKeys.filter(key => key in service).map(key => `${name}: ${key}`),
    );
  const volumeSources = (file: ComposeFile) =>
    Object.values(file.services ?? {}).flatMap(({ volumes = [] }) =>
      volumes.map(volume => (typeof volume === 'string' ? volume.split(':')[0] : volume.source ?? '')),
    );

  it('finds the three services', () => {
    expect(Object.keys(main.services)).toEqual(expect.arrayContaining(['chatterbox', 'victoriametrics', 'vmalert']));
  });

  it.each(services)('drops all the capabilities of %s', (_, service) => {
    expect(service.cap_drop).toEqual(['ALL']);
  });

  it.each(services)('gives %s no capability back, no privileged mode and no access to the computer', (_, service) => {
    expect(hostAccessKeys.filter(key => key in service)).toEqual([]);
  });

  it('runs chatterbox as the user of the image (node), not as a user from docker-compose.yml', () => {
    expect(main.services.chatterbox).not.toHaveProperty('user');
  });

  it.each(services)('stops a program in %s from getting more rights through setuid or file capabilities', (_, service) => {
    // Only this option: for example seccomp:unconfined or apparmor:unconfined would remove a protection.
    expect(service.security_opt).toEqual(['no-new-privileges:true']);
  });

  it.each(services)('limits the number of processes and threads of %s', (_, service) => {
    expect(Number.isInteger(service.pids_limit)).toBe(true);
    expect(service.pids_limit).toBeGreaterThanOrEqual(fewestPids);
    expect(service.pids_limit).toBeLessThanOrEqual(mostPids);
  });

  it.each(composeFiles)('mounts no Docker socket in %s', file => {
    expect(volumeSources(compose(file)).filter(source => /docker\.sock/.test(source))).toEqual([]);
  });

  it.each(mergedFiles)('changes no privilege in %s, so the settings of docker-compose.yml apply', file => {
    expect(privilegesChangedIn(compose(file))).toEqual([]);
  });

  it('finds a privilege that a merged file adds through a YAML merge key', () => {
    const text = 'x-more: &more\n  cap_add: [NET_RAW]\n  pid: host\nservices:\n  chatterbox:\n    <<: *more\n';
    expect(privilegesChangedIn(parseCompose(text))).toEqual(['chatterbox: cap_add', 'chatterbox: pid']);
  });

  it('finds a Docker socket in the long volume syntax', () => {
    const text = 'services:\n  chatterbox:\n    volumes:\n      - type: bind\n        source: /var/run/docker.sock\n        target: /s\n';
    expect(volumeSources(parseCompose(text))).toEqual(['/var/run/docker.sock']);
  });
});

describe('facts that the docs quote', () => {
  // The docs tell users to run "docker logs chatterbox", and to set CHATTER_BIND_ADDRESS in a ".env" file.
  const { services } = compose('docker-compose.yml');
  const chatterPorts = (environment: Record<string, string>) =>
    (services.chatterbox?.ports ?? []).map(port => interpolate(String(port), environment));

  it('keeps the container name chatterbox in docker-compose.yml', () => {
    expect(services).toHaveProperty('chatterbox');
    expect(services.chatterbox.container_name).toBe('chatterbox');
  });

  it('publishes the port of Chatter as "3001:3001" when CHATTER_BIND_ADDRESS is not set, so on all IPv4 and IPv6 addresses as before', () => {
    expect(chatterPorts({})).toEqual(['3001:3001']);
    expect(chatterPorts({ CHATTER_BIND_ADDRESS: '' })).toEqual(['3001:3001']);
  });

  it('opens port 3001 with no host address when CHATTER_BIND_ADDRESS is not set, so Docker uses all addresses', () => {
    expect(portsOpened(services.chatterbox.ports?.[0] ?? '', {})).toEqual({ hostIp: '', containerPorts: [3001] });
  });

  it.each([
    ['192.168.10.5', '192.168.10.5'],
    ['127.0.0.1', '127.0.0.1'],
    ['[::1]', '::1'],
    ['[fd00::5]', 'fd00::5'],
  ])('publishes the port of Chatter only on CHATTER_BIND_ADDRESS=%s', (address, hostIp) => {
    expect(chatterPorts({ CHATTER_BIND_ADDRESS: address })).toEqual([`${address}:3001:3001`]);
    expect(portsOpened(services.chatterbox.ports?.[0] ?? '', { CHATTER_BIND_ADDRESS: address })).toEqual({ hostIp, containerPorts: [3001] });
  });
});

describe('history restore', () => {
  // A history restore writes the samples of a backup file into VictoriaMetrics. When it runs two times, the
  // deduplication keeps one sample for each time, so the charts and the reports do not count a sample two times.
  it.each(['docker-compose.yml', 'docker-compose.dev.yml'])('keeps the deduplication of VictoriaMetrics in %s', file => {
    expect(compose(file).services.victoriametrics.command).toContain('-dedup.minScrapeInterval=1ms');
  });
});

describe('docs links', () => {
  // Released apps link to these pages. Users with an old version still click them.
  const releasedLinks = ['guide/update#back-up', 'guide/manage'];

  function sourceFiles(dir: string): string[] {
    return readdirSync(join(ROOT, dir)).flatMap(name => {
      const path = `${dir}/${name}`;
      if (name === 'node_modules' || name === 'dist') return [];
      if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|md)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  const linksInApp = [...new Set(['apps', 'plugins', 'README.md'].flatMap(path =>
    (path.endsWith('.md') ? [path] : sourceFiles(path)).flatMap(file => docsLinksIn(read(file))),
  ))];

  it('finds the links in the app', () => {
    expect(linksInApp).toContain('guide/update#back-up');
  });

  it.each([...new Set([...releasedLinks, ...linksInApp])])('%s goes to a page and a heading that exist', link => {
    const [page, anchor] = link.split('#');
    const file = docsPageFile(page);
    expect(existsSync(join(ROOT, 'docs', file)), `docs/${file}`).toBe(true);
    if (anchor) expect(anchorsOf(read(join('docs', file)))).toContain(anchor);
  });
});

describe('heading links in the docs', () => {
  // "npm run docs:build" stops on a link to a page that does not exist, but not on a link to a heading
  // (#anchor) that does not exist. The page then opens at the top, and the reader does not find the text.
  function docsPages(dir = ''): string[] {
    return readdirSync(join(ROOT, 'docs', dir)).flatMap(name => {
      const path = dir ? `${dir}/${name}` : name;
      // node_modules, and .vitepress (with the build output in cache/ and dist/)
      if (name === 'node_modules' || name.startsWith('.')) return [];
      if (statSync(join(ROOT, 'docs', path)).isDirectory()) return docsPages(path);
      return name.endsWith('.md') ? [path] : [];
    });
  }

  const pages = docsPages();
  const links = pages.flatMap(page => headingLinksIn(read(join('docs', page)), page).map(link => ({ page, ...link })));

  it('finds the heading links in the docs', () => {
    expect(links).toContainEqual({ page: 'guide/update.md', file: 'security.md', anchor: 'updates-on-the-pi-card' });
  });

  it('go to a page and a heading that exist', () => {
    const anchors = new Map(pages.map(page => [page, anchorsOf(read(join('docs', page)))]));
    const dead = links
      .filter(({ file, anchor, invalid }) => invalid !== undefined || !anchors.get(file)?.includes(anchor))
      .map(({ page, file, anchor, invalid }) => (invalid === undefined ? `${page} -> ${file}#${anchor}` : `${page} -> ${invalid}`));
    expect(dead).toEqual([]);
  });
});

interface WorkflowStep {
  if?: string;
  'continue-on-error'?: unknown;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface WorkflowJob {
  if?: string;
  uses?: string;
  needs?: string | string[];
  environment?: string | { name: string };
  permissions?: unknown;
  secrets?: unknown;
  steps?: WorkflowStep[];
}
interface Workflow {
  permissions?: unknown;
  jobs: Record<string, WorkflowJob>;
}
const workflowFiles = readdirSync(join(ROOT, '.github/workflows')).filter(file => /\.ya?ml$/.test(file));
const workflowText = (file: string) => read(join('.github/workflows', file));
const workflow = (file: string) => parse(workflowText(file)) as Workflow;
const allJobs = () =>
  workflowFiles.flatMap(file => Object.entries(workflow(file).jobs).map(([name, job]) => ({ id: `${file}: ${name}`, job })));

describe('workflow permissions', () => {
  // The token of a workflow can change the repo, the releases and the images on ghcr.io.
  // Each workflow reads only by default. A job that must write gets the permission in its own block.
  // The scopes that a permissions block can write: "write-all" or each scope with a level other than read or none
  function writeScopes(permissions: unknown): string[] {
    if (permissions === undefined || permissions === 'read-all') return [];
    if (typeof permissions === 'string') return [permissions];
    if (permissions === null || typeof permissions !== 'object') return [String(permissions)];
    return Object.entries(permissions as Record<string, string>)
      .filter(([, level]) => level !== 'read' && level !== 'none')
      .map(([scope]) => scope)
      .sort();
  }

  it('finds the workflows', () => {
    expect(workflowFiles).toContain('ci.yml');
  });

  // A top level with no permissions block gives the default token, which can write. So the block must be there.
  // "read-all", {} and the levels read and none are read only.
  function isReadOnlyTop(permissions: unknown) {
    if (permissions === undefined || permissions === null) return false;
    return writeScopes(permissions).length === 0;
  }

  it.each(workflowFiles)('gives only read permissions at the top of %s', file => {
    expect(isReadOnlyTop(workflow(file).permissions), JSON.stringify(workflow(file).permissions)).toBe(true);
  });

  it.each([
    [{ contents: 'read' }, true],
    [{}, true],
    ['read-all', true],
    [undefined, false],
    [null, false],
    ['write-all', false],
    [{ contents: 'write' }, false],
  ])('reads a top level of %j as read only: %s', (permissions, expected) => {
    expect(isReadOnlyTop(permissions)).toBe(expected);
  });

  // Only these jobs can write, each with exactly these scopes. A new job that writes must be added here in review.
  const writers: Record<string, Record<string, string[]>> = {
    'card.yml': { card: ['contents'] },
    'docker.yml': { publish: ['packages'], sign: ['contents'], release: ['contents'], card: ['contents'] },
    'docs.yml': { deploy: ['id-token', 'pages'] },
    'ghcr-cleanup.yml': { cleanup: ['packages'] },
    'release-tags.yml': { tags: ['packages'] },
  };
  const jobIds = workflowFiles.flatMap(file => Object.keys(workflow(file).jobs).map(job => [file, job] as const));

  it('finds each allow-listed job in the workflows', () => {
    const missing = Object.entries(writers).flatMap(([file, jobs]) =>
      Object.keys(jobs).filter(job => !existsSync(join(ROOT, '.github/workflows', file)) || !workflow(file).jobs[job]).map(job => `${file}/${job}`),
    );
    expect(missing).toEqual([]);
  });

  it.each(jobIds)('gives %s (job %s) only the write permissions of the allow-list', (file, job) => {
    expect(writeScopes(workflow(file).jobs[job].permissions)).toEqual(writers[file]?.[job] ?? []);
  });

  it.each([
    [undefined, []],
    [{}, []],
    ['read-all', []],
    [{ contents: 'read', packages: 'none' }, []],
    ['write-all', ['write-all']],
    [{ pages: 'write', 'id-token': 'write', contents: 'read' }, ['id-token', 'pages']],
  ])('reads the write scopes of %j as %j', (permissions, expected) => {
    expect(writeScopes(permissions)).toEqual(expected);
  });

  // A run by hand from a branch would use the workflow file of that branch, with a token that can change a release
  // or the images. A job with more conditions has the gate first, as "(gate) && (other conditions)".
  // These workflows can start by hand (workflow_dispatch), so each job of them that writes has the gate.
  const mainOrTag = "github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')";
  const gatedFiles = ['card.yml', 'ghcr-cleanup.yml', 'release-tags.yml'];
  const gatedJobs = gatedFiles.flatMap(file => Object.keys(writers[file] ?? {}).map(job => [file, job] as const));

  it('finds the writing jobs that need the gate', () => {
    expect(gatedJobs.map(([file]) => file)).toEqual(gatedFiles);
  });

  it.each(gatedJobs)('runs %s (job %s) only from main or a release tag', (file, job) => {
    const condition = workflow(file).jobs[job]?.if?.replace(/\s+/g, ' ') ?? '';
    const rest = condition.startsWith(`(${mainOrTag}) && `) ? condition.slice(mainOrTag.length + 6) : '';
    expect(condition === mainOrTag || isOneGroup(rest), condition).toBe(true);
  });

  // True for "(a || b)", false for "(a) || (b)": an || after the group would skip the gate.
  function isOneGroup(text: string) {
    let depth = 0;
    for (const [index, char] of [...text].entries()) {
      depth += char === '(' ? 1 : char === ')' ? -1 : 0;
      if (depth === 0) return index === text.length - 1 && char === ')';
    }
    return false;
  }

  it.each([
    ['(a || b)', true],
    ['(a) || (b)', false],
    ['a', false],
    ['', false],
  ])('reads %j as one group: %s', (text, expected) => {
    expect(isOneGroup(text)).toBe(expected);
  });
});

describe('pinned actions', () => {
  // A tag such as v4 can move to other code. A full commit cannot. A changed action could change the files that
  // the release signs. The comment gives the version, so Dependabot can update the commit and the comment.
  // A local action or workflow (./) is in this repo, so it needs no commit.
  const pinned = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
  const isLocal = (action: string) => action.startsWith('./');
  // The actions and the called workflows that the parsed file runs, in each job and in each step
  const usesOf = (file: string) =>
    Object.values(workflow(file).jobs).flatMap(job => [job.uses, ...(job.steps ?? []).map(step => step.uses)].filter(uses => uses !== undefined));

  it.each(workflowFiles)('pins each action in %s by a full commit', file => {
    expect(usesOf(file).filter(action => !isLocal(action) && !pinned.test(action))).toEqual([]);
  });

  // The parser drops the comments, so this test reads the lines. A uses line can have quotes around the action.
  const usesLine = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/;
  const versionComment = /^\s+# v\d+(\.\d+)*$/;
  const usesLines = (file: string) =>
    workflowText(file)
      .split('\n')
      .map(line => usesLine.exec(line))
      .filter(match => match !== null)
      .map(([line, action, rest]) => ({ line: line.trim(), action: action.replace(/^(['"])(.*)\1$/, '$2'), rest }));

  it.each(workflowFiles)('gives the version in a comment after each pinned action in %s', file => {
    const lines = usesLines(file);
    // The same uses as the parser finds, so that no uses is missed by the line scan
    expect(lines.map(({ action }) => action)).toEqual(usesOf(file));
    expect(lines.filter(({ action, rest }) => !isLocal(action) && !versionComment.test(rest)).map(({ line }) => line)).toEqual([]);
  });
});

describe('release signing', () => {
  // The update signing key signs each update file. Each Pi card installs a signed update as root.
  // Only the sign job in docker.yml gets the key. It runs no action except the checkout, and it signs only a tag
  // on main, after the publish job.
  const SIGN_JOB = 'docker.yml: sign';
  const { publish, sign, release } = workflow('docker.yml').jobs;
  const environmentOf = (job: WorkflowJob) => (typeof job.environment === 'object' ? job.environment.name : job.environment);
  const needsOf = (job: WorkflowJob) => [job.needs ?? []].flat();
  const stepIndex = (job: WorkflowJob, test: (step: WorkflowStep) => boolean) => (job.steps ?? []).findIndex(test);
  // The check is one script with its own shell test (tools/release/test/check-tag-on-main.test.sh)
  const onMainCheck = (step: WorkflowStep) => step.run?.trim() === 'tools/release/check-tag-on-main.sh';

  // GitHub reads the names in an expression in any case, so secrets.update_signing_key is the same key.
  // The parsed file has no comments, so a comment that names the key does not count.
  it('gives the signing key only to the sign job', () => {
    expect(allJobs().filter(({ job }) => /UPDATE_SIGNING_KEY/i.test(JSON.stringify(job))).map(({ id }) => id)).toEqual([SIGN_JOB]);
    const mentions = workflowFiles.flatMap(file => JSON.stringify(workflow(file)).match(/secrets\.UPDATE_SIGNING_KEY/gi) ?? []);
    expect(mentions).toHaveLength(1);
  });

  // toJSON(secrets) gives all the secrets, and secrets[<name>] can give any secret by a name that the test cannot read
  it.each(workflowFiles)('reads no secret by a computed name, and not all the secrets, in %s', file => {
    const text = JSON.stringify(workflow(file));
    expect(text).not.toMatch(/toJSON\(\s*secrets\s*\)/i);
    expect(text).not.toMatch(/\bsecrets\s*\[/i);
  });

  it('gives the release environment, which holds the key, only to the sign job', () => {
    expect(allJobs().filter(({ job }) => environmentOf(job) === 'release').map(({ id }) => id)).toEqual([SIGN_JOB]);
  });

  it('gives no job all the secrets', () => {
    expect(allJobs().filter(({ job }) => job.secrets === 'inherit').map(({ id }) => id)).toEqual([]);
  });

  it('runs no action in the sign job except the checkout, as the first step', () => {
    const actions = (sign.steps ?? []).flatMap((step, index) => (step.uses ? [`${index}: ${step.uses.split('@')[0]}`] : []));
    expect(actions).toEqual(['0: actions/checkout']);
  });

  // A push to main and a pre-release tag such as v1.2.0-rc1 get no update file. The update helper accepts only a
  // version such as 1.2.0.
  const releaseTagOnly = "startsWith(github.ref, 'refs/tags/v') && !contains(github.ref_name, '-')";
  const conditionOf = (jobOrStep: { if?: string }) => jobOrStep.if?.replace(/\s+/g, ' ').trim();

  it('signs only for a release tag such as v1.2.0', () => {
    expect(conditionOf(sign)).toBe(releaseTagOnly);
  });

  // The release job runs after the sign job. Its own condition keeps it off a push to main, also when "needs" changes.
  it('adds the release files only for a release tag such as v1.2.0', () => {
    expect(conditionOf(release)).toBe(releaseTagOnly);
  });

  it('signs only after the publish job', () => {
    expect(needsOf(sign)).toContain('publish');
  });

  it('gives the sign job only the permissions that it needs', () => {
    expect(sign.permissions).toEqual({ contents: 'write', packages: 'read' });
  });

  it.each([
    ['publish', publish, (step: WorkflowStep) => step.uses?.startsWith('docker/build-push-action@') ?? false],
    ['sign', sign, (step: WorkflowStep) => step.run?.includes('make-update-file.sh') ?? false],
  ] as const)('checks in the %s job that the tag is on main, before it publishes or signs', (_name, job, isGuarded) => {
    const check = stepIndex(job, onMainCheck);
    const guarded = stepIndex(job, isGuarded);
    expect(check).toBeGreaterThanOrEqual(0);
    expect(guarded).toBeGreaterThan(check);
    // The check script needs the history of main
    expect(job.steps?.find(step => step.uses?.startsWith('actions/checkout@'))?.with?.['fetch-depth']).toBe(0);
  });

  // The sign job runs only for a tag, so its check has no condition. The publish job also builds for a push to main,
  // so its check runs for each tag. A failed check must stop the job.
  it.each([
    ['publish', publish, "startsWith(github.ref, 'refs/tags/v')"],
    ['sign', sign, undefined],
  ] as const)('stops the %s job when the tag is not on main', (_name, job, condition) => {
    const checks = (job.steps ?? []).filter(onMainCheck);
    expect(checks).toHaveLength(1);
    expect(conditionOf(checks[0])).toBe(condition);
    expect(checks[0]['continue-on-error']).toBeUndefined();
  });
});

describe('test runs', () => {
  // npm test runs each tools folder with test:tools. npm run coverage runs the projects of vitest.config.ts.
  // A tools folder with tests must be in both, or one of the two runs skips it.
  const toolsWithTests = readdirSync(join(ROOT, 'tools')).filter(name =>
    statSync(join(ROOT, 'tools', name)).isDirectory() &&
    readdirSync(join(ROOT, 'tools', name)).some(file => /\.test\.ts$/.test(file)),
  );
  const testTools = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts['test:tools'];
  const projects = /projects:\s*\[([^\]]*)\]/.exec(read('vitest.config.ts'))?.[1] ?? '';

  it('finds the tools folders with tests', () => {
    expect(toolsWithTests).toContain('guardrails');
  });

  it.each(toolsWithTests)('runs tools/%s in npm test and in npm run coverage', name => {
    expect(testTools).toContain(`--root tools/${name}`);
    expect(projects).toContain(`'tools/${name}'`);
  });

  // npm test does not run the shell tests of the Pi card, of the release scripts and of VictoriaMetrics (some need Linux
  // or Docker).
  // Only a workflow runs them, so a test script that no workflow runs never runs. The *.lib.sh files and
  // in-linux.sh are helpers, not tests. Only the run text of the steps counts, not a comment.
  const shellTests = ['tools/pi-image/test', 'tools/release/test', 'tools/victoria-test'].flatMap(dir =>
    readdirSync(join(ROOT, dir)).filter(file => file.endsWith('.test.sh')).map(file => `${dir}/${file}`),
  );
  const runText = workflowFiles
    .flatMap(file => Object.values(workflow(file).jobs).flatMap(job => (job.steps ?? []).map(step => step.run ?? '')))
    .join('\n');

  it('finds the shell tests of the Pi card, of the release scripts and of VictoriaMetrics', () => {
    expect(shellTests).toEqual(expect.arrayContaining([
      'tools/pi-image/test/update-chatter-check.test.sh',
      'tools/release/test/check-tag-on-main.test.sh',
      'tools/victoria-test/old-volume.test.sh',
    ]));
  });

  it.each(shellTests)('runs %s in a workflow', path => {
    expect(runText).toContain(path);
  });
});
