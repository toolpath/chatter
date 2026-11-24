// Reads the "ports:" entries of a Docker Compose file.

export type ComposePort =
  | string
  | number
  | { target?: string | number; published?: string | number; host_ip?: string; protocol?: string };

export interface OpenedPorts {
  /** The host address that the ports listen on. Empty means all addresses. */
  hostIp: string;
  /** The ports in the container that the entry opens */
  containerPorts: number[];
}

/** The values of the variables, as Docker Compose gets them from the shell or from a ".env" file */
export type Environment = Readonly<Record<string, string | undefined>>;

// ${NAME}, ${NAME:-word}, ${NAME-word}, ${NAME:+word} or ${NAME+word}, with no "$" or brace in the word
const BRACED = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+])([^${}]*))?$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

function cannotRead(text: string): never {
  throw new Error(`The guardrail test cannot read the variable in "${text}". Use $NAME, \${NAME}, \${NAME:-word} or \${NAME:+word}.`);
}

/** Gives each variable of the text to onVariable, and puts the result in its place. "$$" is one "$". */
function replaceVariables(text: string, onVariable: (name: string, operator?: string, word?: string) => string): string {
  let result = '';
  let from = 0;
  for (let dollar = text.indexOf('$'); dollar >= 0; dollar = text.indexOf('$', from)) {
    result += text.slice(from, dollar);
    const rest = text.slice(dollar + 1);
    if (rest.startsWith('$')) {
      result += '$';
      from = dollar + 2;
    } else if (rest.startsWith('{')) {
      const end = rest.indexOf('}');
      const match = end < 0 ? null : BRACED.exec(rest.slice(1, end));
      if (!match) cannotRead(text);
      result += onVariable(match[1], match[2], match[3] ?? '');
      from = dollar + 2 + end;
    } else {
      const name = NAME.exec(rest);
      if (!name) cannotRead(text);
      result += onVariable(name[0]);
      from = dollar + 1 + name[0].length;
    }
  }
  return result + text.slice(from);
}

/** The text with each variable replaced, by the rules of Docker Compose. A variable that is not set is empty. */
export function interpolate(text: string, environment: Environment = {}): string {
  return replaceVariables(text, (name, operator, word = '') => {
    const value = environment[name];
    switch (operator) {
      case ':-':
        return value ? value : word;
      case '-':
        return value ?? word;
      case ':+':
        return value ? word : '';
      case '+':
        return value === undefined ? '' : word;
      default:
        return value ?? '';
    }
  });
}

/** The names of the variables in the text, each one time */
export function variablesIn(text: string): string[] {
  const names = new Set<string>();
  replaceVariables(text, name => {
    names.add(name);
    return '';
  });
  return [...names];
}

function range(text: string): number[] {
  const [first, last = first] = text.split('-').map(Number);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/**
 * The parts of a short-form entry: [HOST_IP:][HOST_PORT:]CONTAINER_PORT[/PROTOCOL]. An IPv6 host address is in brackets,
 * or (Docker Compose accepts this too) it is all the parts before the last two. As in Docker Compose, the protocol
 * comes off the last part only, so a "/" in the host address does not cut the ports.
 */
function shortFormParts(text: string): string[] {
  const ipv6 = /^\[([^\]]+)\]:(.*)$/.exec(text);
  const parts = ipv6 ? [ipv6[1], ...ipv6[2].split(':')] : text.split(':');
  return parts.length >= 3 ? [parts.slice(0, -2).join(':'), ...parts.slice(-2)] : parts;
}

/** The host address and the container ports of one "ports:" entry, in the short or the long form. */
export function portsOpened(entry: ComposePort, environment: Environment = {}): OpenedPorts {
  if (typeof entry === 'number') return { hostIp: '', containerPorts: [entry] };
  if (typeof entry === 'object') {
    return {
      hostIp: interpolate(entry.host_ip ?? '', environment),
      containerPorts: range(interpolate(String(entry.target ?? ''), environment)),
    };
  }

  const parts = shortFormParts(interpolate(entry, environment));
  const containerPort = parts[parts.length - 1].replace(/\/[^/]*$/, '');
  return { hostIp: parts.length === 3 ? parts[0] : '', containerPorts: range(containerPort) };
}

// Stands for any text that a user can give a variable. It has no ":" and no "/", so it stays in one part.
const USER_TEXT = '<user text>';

/**
 * True when a variable can change the host port, the container port or the protocol of the entry. Only the host
 * address may come from a variable: a ".env" file can hold any text. The test tries each variable not set, empty and
 * set to any text, and looks for that text in the last two parts.
 */
export function variableInPorts(entry: ComposePort): boolean {
  if (typeof entry === 'number') return false;
  if (typeof entry === 'object') {
    return [entry.target, entry.published, entry.protocol].some(value => variablesIn(String(value ?? '')).length > 0);
  }

  const names = variablesIn(entry);
  const environments = names.reduce<Environment[]>(
    (all, name) => all.flatMap(environment => [undefined, '', USER_TEXT].map(value => ({ ...environment, [name]: value }))),
    [{}],
  );
  return environments.some(environment => shortFormParts(interpolate(entry, environment)).slice(-2).join(':').includes(USER_TEXT));
}
