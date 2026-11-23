import { z } from 'zod';
import { isLocalRange } from '../discovery/addressRange.js';
import { MAX_TREE_DEPTH } from '../ftp/FTPClient.js';
import {
  ALERT_CHECKS, ALERT_SEVERITIES, ALERT_SUBJECT_IDS, MAX_ALERT_FOR_MINUTES, MAX_ALERT_NAME_LENGTH, MAX_ALERT_QUERY_LENGTH,
  MAX_ALERT_RULES_PER_MACHINE, MAX_IGNORE_PATTERNS, patternProblem, type AlertSubject,
} from '@local-chatter/shared';
import { HISTORY_VALUES, isValidIPv4, OPCUA_SECURITY_MODES, STATE_PERIOD_KINDS, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, ROLES, SUPPORTED_MACHINE_TYPES } from '@local-chatter/shared';

/** What each route accepts. A value that does not fit gets a 400 reply with the message below. */

const MACHINE_FIELDS_REQUIRED = 'Type, name, and host are required';
const BAD_IP = 'Invalid IP address format';
const NO_FILE = 'No file provided';
const NOT_AN_OBJECT = { error: 'The JSON body must be an object' };

const MIN_PORT = 1;
const MAX_PORT = 65535;
const MAX_USERNAME_LENGTH = 64;
const MAX_MACHINE_ID_LENGTH = 200;
const MAX_OPCUA_TEXT_LENGTH = 200;

const ipv4 = z.string({ error: BAD_IP }).trim().refine(isValidIPv4, BAD_IP);
const port = (name: string) => {
  const outOfRange = `${name} must be ${MIN_PORT} to ${MAX_PORT}`;
  return z.number({ error: `${name} must be a number` }).int().min(MIN_PORT, outOfRange).max(MAX_PORT, outOfRange);
};
const text = (name: string) => z.string({ error: `${name} must be text` });
const wholeNumberText = (name: string) => z.string().regex(/^\d+$/, `${name} must be a whole number`);
/** A whole number that the web form may send as text. Empty text means "not set". */
const numberOrText = (name: string) =>
  z.union([z.number().int().min(0), z.string().trim().regex(/^\d*$/)], { error: `${name} must be a whole number` });

const macro = z.object({
  location: z.number({ error: 'Each macro needs a location number' }).int().min(0),
  name: text('Macro name').optional(),
});

/** The settings that every machine type has */
const machineSettings = {
  dataPort: port('dataPort').optional(),
  queryPort: port('queryPort').optional(),
  ftpPort: port('ftpPort').optional(),
  ftpUser: text('ftpUser').optional(),
  ftpPassword: text('ftpPassword').optional(),
  defaultUnit: text('defaultUnit').optional(),
  macros: z.array(macro, { error: 'macros must be a list' }).optional(),
  mtConnectPort: port('mtConnectPort').optional(),
  mtConnectDeviceId: text('mtConnectDeviceId').optional(),
  agentType: text('agentType').optional(),
  focasPort: port('focasPort').optional(),
  opcuaPort: port('opcuaPort').optional(),
  opcuaUser: text('opcuaUser').max(MAX_OPCUA_TEXT_LENGTH, 'opcuaUser is too long').optional(),
  opcuaPassword: text('opcuaPassword').max(MAX_OPCUA_TEXT_LENGTH, 'opcuaPassword is too long').optional(),
  opcuaSecurity: z.enum(OPCUA_SECURITY_MODES, { error: 'opcuaSecurity must be "none" or "signAndEncrypt"' }).optional(),
};

export const addMachineSchema = z.object({
  type: z.string({ error: MACHINE_FIELDS_REQUIRED }).trim().min(1, MACHINE_FIELDS_REQUIRED)
    .pipe(z.enum(SUPPORTED_MACHINE_TYPES, { error: `Type must be one of: ${SUPPORTED_MACHINE_TYPES.map(type => `"${type}"`).join(', ')}` })),
  name: z.string({ error: MACHINE_FIELDS_REQUIRED }).trim().min(1, MACHINE_FIELDS_REQUIRED),
  host: z.string({ error: MACHINE_FIELDS_REQUIRED }).trim().min(1, MACHINE_FIELDS_REQUIRED).pipe(ipv4),
  ...machineSettings,
}, NOT_AN_OBJECT);

export const updateMachineSchema = z.object({
  name: z.string({ error: 'name must be text' }).trim().min(1, 'name must not be empty').optional(),
  host: ipv4.optional(),
  ...machineSettings,
  toolNumberVariable: numberOrText('toolNumberVariable').optional(),
  partCounterVariable: numberOrText('partCounterVariable').optional(),
  ignoredMessageTypes: z.array(z.number().int(), { error: 'ignoredMessageTypes must be a list of numbers' }).optional(),
}, NOT_AN_OBJECT);

/** The thumbprint that the Admin saw: SHA-256, 64 hex digits */
export const trustCertificateSchema = z.object({
  thumbprint: z.string({ error: 'thumbprint is required' }).trim().toLowerCase()
    .regex(/^[0-9a-f]{64}$/, 'thumbprint must be the SHA-256 thumbprint: 64 hex digits'),
}, NOT_AN_OBJECT);

export const scanPortSchema = z.object({
  host: z.string({ error: 'Host is required' }).trim().min(1, 'Host is required').pipe(ipv4),
}, NOT_AN_OBJECT);

export const scanNetworkSchema = z.object({
  range: z.string({ error: 'range is required' }).trim()
    .refine(isLocalRange, 'Type the first three numbers of a local network address, such as 192.168.1'),
}, NOT_AN_OBJECT);

/**
 * A path or a name on the machine. FTP sends it in a command line, so a line break would start a second command,
 * for example DELE. \p{Cc} is each control character, CR, LF and NUL included.
 */
const CONTROL_CHARACTER_IN_PATH = 'A path or a file name on the machine cannot have a line break or another control character';
const hasNoControlCharacter = (text: string) => !/\p{Cc}/u.test(text);
const remoteName = (error?: string) => z.string({ error }).refine(hasNoControlCharacter, CONTROL_CHARACTER_IN_PATH);
const requiredRemotePath = (requiredMessage: string) => remoteName(requiredMessage).min(1, requiredMessage);

/** JSON text: the name on the machine for each file name */
const BAD_TARGET_NAMES = 'targetNames must give a name on the machine for each file name';
const targetNamesJson = z.string()
  .transform((json, context) => {
    try {
      return JSON.parse(json) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'targetNames must be JSON text' });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), remoteName(BAD_TARGET_NAMES), { error: BAD_TARGET_NAMES }))
  // A key with a bad character matches no file, but a request with one is not from the web app
  .refine(names => Object.keys(names).every(hasNoControlCharacter), CONTROL_CHARACTER_IN_PATH);

/** The names on the machine from targetNames text, or why the text is bad */
export type TargetNames = { ok: true; names: Record<string, string> } | { ok: false; error: string };

/** Read targetNames text. A form with no targetNames gives no names. It does not throw on bad text. */
export function readTargetNames(json: string | undefined): TargetNames {
  if (json === undefined) return { ok: true, names: {} };
  const names = targetNamesJson.safeParse(json);
  return names.success ? { ok: true, names: names.data } : { ok: false, error: names.error.issues[0].message };
}

/** Each folder level is a LIST on the machine, so the depth has a limit */
const BAD_TREE_DEPTH = `depth must be a whole number from 1 to ${MAX_TREE_DEPTH}`;
const treeDepthText = z.string().refine(
  depth => /^\d+$/.test(depth) && Number(depth) >= 1 && Number(depth) <= MAX_TREE_DEPTH,
  BAD_TREE_DEPTH
);

export const fileTreeQuery = z.object({
  path: remoteName().optional(),
  depth: treeDepthText.optional(),
});

export const filePathQuery = z.object({
  path: requiredRemotePath('File path is required'),
});

const trueOrFalse = z.enum(['true', 'false'], { error: 'overwrite must be "true" or "false"' });

export const uploadForm = z.object({
  file: z.instanceof(File, { error: NO_FILE }),
  path: requiredRemotePath('Remote path is required'),
  overwrite: trueOrFalse.optional(),
  targetName: remoteName().optional(),
});

/** The FANUC FOCAS2 library that an admin uploads */
export const focasLibraryForm = z.object({
  file: z.instanceof(File, { error: NO_FILE }),
});

/** The form gives one file as a value and several files as a list */
export const batchUploadForm = z.object({
  files: z.union([z.instanceof(File), z.array(z.instanceof(File)).min(1)], { error: 'No files provided' })
    .transform(files => [files].flat())
    // A file keeps its own name on the machine when targetNames gives no other name
    .refine(files => files.every(file => hasNoControlCharacter(file.name)), CONTROL_CHARACTER_IN_PATH),
  basePath: requiredRemotePath('Base path is required'),
  overwrite: trueOrFalse.optional(),
  /**
   * JSON text: the name on the machine for each file name. Bad JSON gets a 400, so no file goes to a wrong name.
   * The field stays text after the check, because the typed web client sends the form as the route reads it.
   */
  targetNames: z.string().superRefine((json, context) => {
    const names = readTargetNames(json);
    if (!names.ok) context.addIssue({ code: 'custom', message: names.error });
  }).optional(),
});

export const uploadListQuery = z.object({
  limit: wholeNumberText('limit').optional(),
});

/** A row id in the address, as in /uploads/42/events */
const rowId = (name: string) => z.string().regex(/^[1-9]\d{0,15}$/, `The ${name} must be a whole number`).transform(Number);

/** The machine, and one uploaded file of it */
export const uploadFileParams = z.object({ id: z.string(), fileId: rowId('file id') });

/** The machine, and one upload to it */
export const uploadEventParams = z.object({ id: z.string(), eventId: rowId('upload id') });

/** The machine, and the value whose history to read */
export const historyParams = z.object({
  id: z.string(),
  value: z.enum(HISTORY_VALUES, { error: `value must be one of: ${HISTORY_VALUES.join(', ')}` }),
});

/**
 * The end of a chart's time, to look back in time: a date and a time with a zone, for example 2026-11-19T15:00:00Z.
 * A time with no zone would be the local time of the server.
 */
const endTime = z.string()
  .refine(
    text => /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(text) && Number.isFinite(Date.parse(text)),
    'end must be a time with a zone, such as 2026-11-19T15:00:00Z',
  )
  .optional();

/**
 * How far back the history goes, and the time that each average covers.
 * Examples: range "-1h", window "10s". At most 6 digits, so the numbers stay in range.
 */
export const historyQuery = z.object({
  range: z.string().regex(/^-[1-9]\d{0,5}(s|m|h|d|w)$/, 'range must look like -1h').optional(),
  window: z.string().regex(/^[1-9]\d{0,5}(s|m|h|d)$/, 'window must look like 10s').optional(),
  end: endTime,
});

/** How far back, and optionally one kind of state */
export const periodQuery = z.object({
  range: historyQuery.shape.range,
  kind: z.enum(STATE_PERIOD_KINDS, { error: `kind must be one of: ${STATE_PERIOD_KINDS.join(', ')}` }).optional(),
});

/** The state timeline goes back at most this far. The chart shows at most 7 days. */
const MAX_TIMELINE_DAYS = 31;
const TIMELINE_UNIT_DAYS: Record<string, number> = { s: 1 / 86_400, m: 1 / 1440, h: 1 / 24, d: 1, w: 7 };

/** How far back the state timeline goes */
export const timelineQuery = z.object({
  range: z.string()
    .regex(/^-[1-9]\d{0,5}(s|m|h|d|w)$/, 'range must look like -1h')
    .refine(range => Number(range.slice(1, -1)) * TIMELINE_UNIT_DAYS[range.slice(-1)] <= MAX_TIMELINE_DAYS,
      `range can go back at most ${MAX_TIMELINE_DAYS} days`)
    .optional(),
  end: endTime,
});

/** VictoriaMetrics keeps the history 1 year, so a longer report has no more data */
const MAX_REPORT_DAYS = 366;
const REPORT_UNIT_DAYS: Record<string, number> = { m: 1 / 1440, h: 1 / 24, d: 1, w: 7 };

/** How far back the machine report goes. It reads minute averages, so the range is whole minutes. */
export const reportQuery = z.object({
  range: z.string()
    .regex(/^-[1-9]\d{0,5}(m|h|d|w)$/, 'range must look like -1d (minutes, hours, days, or weeks)')
    .refine(range => Number(range.slice(1, -1)) * REPORT_UNIT_DAYS[range.slice(-1)] <= MAX_REPORT_DAYS,
      `range can go back at most ${MAX_REPORT_DAYS} days`)
    .optional(),
});

/** How far back, the alerts that fire now or all alerts, and optionally one machine */
export const alertQuery = z.object({
  range: historyQuery.shape.range,
  state: z.enum(['firing', 'all'], { error: 'state must be "firing" or "all"' }).optional(),
  machine: z.string().max(MAX_MACHINE_ID_LENGTH, 'The machine id is too long').optional(),
});

/** Long input costs scrypt time, so every password field has a top limit */
const TOO_LONG = 'The password is too long';

/** A password that the user types to prove who they are */
const givenPassword = (requiredMessage: string) =>
  z.string({ error: requiredMessage }).min(1, requiredMessage).max(MAX_PASSWORD_LENGTH, TOO_LONG);

const passwordSchema = z.string({ error: 'Password is required' })
  .min(MIN_PASSWORD_LENGTH, `The password must have at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, TOO_LONG);

/** Programs send "username:password" (HTTP Basic), so a colon cannot be part of the username */
const usernameSchema = z.string({ error: 'Username is required' }).trim()
  .min(1, 'Username is required')
  .max(MAX_USERNAME_LENGTH, `The username must have at most ${MAX_USERNAME_LENGTH} characters`)
  .regex(/^[^:\p{Cc}]+$/u, 'The username cannot have a colon (:) in it');

export const setUpSchema = z.object({ username: usernameSchema, password: passwordSchema }, NOT_AN_OBJECT);

export const logInSchema = z.object({
  username: usernameSchema,
  password: givenPassword('Password is required'),
}, NOT_AN_OBJECT);

export const changePasswordSchema = z.object({
  currentPassword: givenPassword('The current password is required'),
  newPassword: passwordSchema,
}, NOT_AN_OBJECT);

/** Longer than any IPv6 address with a range, like "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255/128" */
const MAX_ADDRESS_LENGTH = 64;
const MAX_TRUSTED_PROXIES = 20;

export const trustedProxiesSchema = z.object({
  addresses: z.array(
    z.string({ error: 'Each proxy must be an address' }).trim()
      .min(1, 'A proxy address cannot be empty')
      .max(MAX_ADDRESS_LENGTH, 'A proxy address is too long'),
    { error: 'addresses must be a list' },
  ).max(MAX_TRUSTED_PROXIES, `Trust ${MAX_TRUSTED_PROXIES} proxies or fewer`),
}, NOT_AN_OBJECT);

const ADDRESS_OR_USERNAME = 'Give an address or a username to unlock';

/** The computer (address), or the user on all computers (username), to unlock in Settings > Logins */
export const unlockSchema = z.object({
  address: z.string({ error: 'address must be text' }).trim()
    .min(1, 'address is required')
    .max(MAX_ADDRESS_LENGTH, 'The address is too long')
    .optional(),
  username: z.string({ error: 'username must be text' }).trim()
    .min(1, 'username is required')
    .max(MAX_USERNAME_LENGTH, 'The username is too long')
    .optional(),
}, NOT_AN_OBJECT).refine(
  unlock => unlock.address !== undefined || unlock.username !== undefined,
  ADDRESS_OR_USERNAME,
);

const roleSchema = z.enum(ROLES, { error: 'The role must be "viewer", "operator", or "admin"' });

/** A user that an admin adds on the Users and roles tab */
export const addUserSchema = z.object({ username: usernameSchema, password: passwordSchema, role: roleSchema }, NOT_AN_OBJECT);

export const changeRoleSchema = z.object({ role: roleSchema }, NOT_AN_OBJECT);

/** The new password that an admin sets for a user */
export const setPasswordSchema = z.object({ password: passwordSchema }, NOT_AN_OBJECT);

/** The user in the address, as in /settings/users/12 */
export const userIdParam = z.object({ id: rowId('user id') });

/** The switches in Settings > Updates */
export const updateSettingsSchema = z.object({
  checkGitHub: z.boolean({ error: 'checkGitHub must be true or false' }),
}, NOT_AN_OBJECT);

const MAX_RULE_ID_LENGTH = 100;
const MAX_COPY_MACHINES = 100;
const machineId = z.string({ error: 'The machine id must be text' }).min(1).max(MAX_MACHINE_ID_LENGTH, 'The machine id is too long');
const alertQueryText = z.string({ error: 'The query must be text' }).trim()
  .min(1, 'Write a query')
  .max(MAX_ALERT_QUERY_LENGTH, `The query can have at most ${MAX_ALERT_QUERY_LENGTH} characters`);

/** The fields that each alert rule has */
const alertRuleBase = {
  id: z.string().max(MAX_RULE_ID_LENGTH).optional(),
  enabled: z.boolean({ error: 'enabled must be true or false' }),
  forMinutes: z.number({ error: 'The minutes must be a number' }).int('The minutes must be a whole number')
    .min(0, 'The minutes cannot be less than 0')
    .max(MAX_ALERT_FOR_MINUTES, `The minutes can be at most ${MAX_ALERT_FOR_MINUTES} (one day)`),
  severity: z.enum(ALERT_SEVERITIES, { error: 'The level must be "warning" or "critical"' }),
};

const simpleAlertRule = z.object({
  ...alertRuleBase,
  kind: z.literal('simple'),
  subject: z.enum(ALERT_SUBJECT_IDS as [AlertSubject, ...AlertSubject[]], { error: 'Unknown value for an alert rule' }),
  check: z.enum(ALERT_CHECKS, { error: 'The check must be "above" or "below"' }),
  limit: z.number({ error: 'The limit must be a number' }).finite(),
});

const queryAlertRule = z.object({
  ...alertRuleBase,
  kind: z.literal('query'),
  name: z.string({ error: 'The name must be text' }).trim()
    .max(MAX_ALERT_NAME_LENGTH, `The name can have at most ${MAX_ALERT_NAME_LENGTH} characters`),
  query: alertQueryText,
});

/** All alert rules of one machine, from the Alert rules tab */
export const alertRulesSchema = z.object({
  rules: z.array(z.discriminatedUnion('kind', [simpleAlertRule, queryAlertRule], { error: 'A rule must be "simple" or "query"' }), { error: 'rules must be a list' })
    .max(MAX_ALERT_RULES_PER_MACHINE, `A machine can have at most ${MAX_ALERT_RULES_PER_MACHINE} alert rules`),
}, NOT_AN_OBJECT);

/** The machines to copy the alert rules to */
export const copyAlertRulesSchema = z.object({
  machineIds: z.array(machineId, { error: 'machineIds must be a list' })
    .min(1, 'Choose at least one machine')
    .max(MAX_COPY_MACHINES, `Copy to at most ${MAX_COPY_MACHINES} machines at a time`),
}, NOT_AN_OBJECT);

/** A custom query to run once on one machine */
export const testAlertQuerySchema = z.object({ machineId, query: alertQueryText }, NOT_AN_OBJECT);

const MAX_CHANNEL_VALUE_LENGTH = 2000;
const MAX_CHANNEL_LIST_LENGTH = 50;
const MAX_CHANNEL_FIELDS = 30;
const MAX_LINK_LENGTH = 500;

const channelValue = z.union([
  z.string().max(MAX_CHANNEL_VALUE_LENGTH, 'A value is too long'),
  z.array(z.string().max(MAX_CHANNEL_VALUE_LENGTH, 'A value is too long'))
    .max(MAX_CHANNEL_LIST_LENGTH, `A list can have at most ${MAX_CHANNEL_LIST_LENGTH} values`),
], { error: 'Each value must be text or a list of text' });

/** One ignore pattern, trimmed. patternProblem gives the reason in plain words. */
const ignorePattern = z.string({ error: 'Each ignore pattern must be text' }).trim().superRefine((pattern, context) => {
  const problem = patternProblem(pattern);
  if (problem) context.addIssue({ code: 'custom', message: problem });
});

/** The match is not case-sensitive, so "Door open" and "door open" are the same pattern. The first one stays. */
function withoutSamePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  return patterns.filter(pattern => {
    const key = pattern.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const ignorePatterns = z.array(ignorePattern, { error: 'ignorePatterns must be a list' })
  .max(MAX_IGNORE_PATTERNS, `A channel can have at most ${MAX_IGNORE_PATTERNS} ignore patterns`)
  .transform(withoutSamePatterns);

/**
 * A channel form, to save it or to send a test. The channel type checks its own values.
 * An empty secret on an edit keeps the saved secret.
 */
export const channelInputSchema = z.object({
  type: text('type').max(MAX_RULE_ID_LENGTH),
  name: text('Name'),
  values: z.record(z.string(), channelValue, { error: 'values must be an object' })
    .refine(values => Object.keys(values).length <= MAX_CHANNEL_FIELDS, 'Too many values'),
  minSeverity: z.enum(ALERT_SEVERITIES, { error: 'The level must be "warning" or "critical"' }),
  machineIds: z.array(machineId, { error: 'machineIds must be a list or null' }).nullable(),
  /** Optional, so an older app keeps the saved patterns on an edit */
  ignorePatterns: ignorePatterns.optional(),
  enabled: z.boolean({ error: 'enabled must be true or false' }),
  clearSecrets: z.array(z.string().max(MAX_RULE_ID_LENGTH)).max(MAX_CHANNEL_FIELDS).optional(),
}, NOT_AN_OBJECT);

/** The channel in the address, as in /notification-channels/<id> */
export const channelIdParam = z.object({ id: z.string().min(1).max(MAX_RULE_ID_LENGTH) });

/** The filter of the message list */
export const notificationMessagesQuery = z.object({
  channel: z.string().min(1).max(MAX_RULE_ID_LENGTH).optional(),
});

/** Blank text means "not set" */
const blankIsNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

function isTimeZoneName(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** Settings > Notifications: the address of Chatter for the links, and the time zone of the shop */
export const notificationSettingsSchema = z.object({
  linkBaseUrl: z.preprocess(blankIsNull, z.url({
    protocol: /^https?$/, error: 'The Chatter address must start with http:// or https://, for example http://chatter.local:3001',
  }).max(MAX_LINK_LENGTH, 'The Chatter address is too long')
    // The address goes in each message, so a password in it would go to each phone
    .refine(address => !URL.canParse(address) || !new URL(address).username, 'The Chatter address must not have a user name or password in it')
    .nullable()),
  timeZone: z.preprocess(blankIsNull, z.string({ error: 'The time zone must be text' }).trim()
    .refine(isTimeZoneName, 'Chatter does not know this time zone. Use a name like America/Chicago.').nullable()),
}, NOT_AN_OBJECT);

const backupTime = z.number({ error: 'The time must be a number of milliseconds' }).int('The time must be a whole number').nonnegative();

/** Back up the history of a machine: all of it (no from), or a time range. `to` is now when it is not given. */
export const historyBackupSchema = z.object({
  from: backupTime.nullable().optional(),
  to: backupTime.optional(),
  averagesOnly: z.boolean({ error: 'averagesOnly must be true or false' }).optional(),
}, NOT_AN_OBJECT).refine(({ from, to }) => from === undefined || from === null || to === undefined || from < to, 'The start must be before the end');

/** Write a received history file into the machine */
export const historyRestoreSchema = z.object({
  alertRules: z.boolean({ error: 'alertRules must be true or false' }),
}, NOT_AN_OBJECT);
