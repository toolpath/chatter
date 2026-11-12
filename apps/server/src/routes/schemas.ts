import { z } from 'zod';
import { isLocalRange } from '../discovery/addressRange.js';
import {
  ALERT_CHECKS, ALERT_SEVERITIES, ALERT_SUBJECT_IDS, MAX_ALERT_FOR_MINUTES, MAX_ALERT_NAME_LENGTH, MAX_ALERT_QUERY_LENGTH,
  MAX_ALERT_RULES_PER_MACHINE, type AlertSubject,
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
    .pipe(z.enum(SUPPORTED_MACHINE_TYPES, { error: 'Type must be "brother", "haas", "mtconnect", "fanuc", or "siemens"' })),
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

export const scanPortSchema = z.object({
  host: z.string({ error: 'Host is required' }).trim().min(1, 'Host is required').pipe(ipv4),
}, NOT_AN_OBJECT);

export const scanNetworkSchema = z.object({
  range: z.string({ error: 'range is required' }).trim()
    .refine(isLocalRange, 'Type the first three numbers of a local network address, such as 192.168.1'),
}, NOT_AN_OBJECT);

export const fileTreeQuery = z.object({
  path: z.string().optional(),
  depth: wholeNumberText('depth').optional(),
});

export const filePathQuery = z.object({
  path: z.string({ error: 'File path is required' }).min(1, 'File path is required'),
});

const trueOrFalse = z.enum(['true', 'false'], { error: 'overwrite must be "true" or "false"' });

export const uploadForm = z.object({
  file: z.instanceof(File, { error: NO_FILE }),
  path: z.string({ error: 'Remote path is required' }).min(1, 'Remote path is required'),
  overwrite: trueOrFalse.optional(),
  targetName: z.string().optional(),
});

/** The FANUC FOCAS2 library that an admin uploads */
export const focasLibraryForm = z.object({
  file: z.instanceof(File, { error: NO_FILE }),
});

/** The form gives one file as a value and several files as a list */
export const batchUploadForm = z.object({
  files: z.union([z.instanceof(File), z.array(z.instanceof(File)).min(1)], { error: 'No files provided' })
    .transform(files => [files].flat()),
  basePath: z.string({ error: 'Base path is required' }).min(1, 'Base path is required'),
  overwrite: trueOrFalse.optional(),
  /** JSON text: the name on the machine for each file name */
  targetNames: z.string().optional(),
});

export const uploadListQuery = z.object({
  limit: wholeNumberText('limit').optional(),
});

/** The machine, and the value whose history to read */
export const historyParams = z.object({
  id: z.string(),
  value: z.enum(HISTORY_VALUES, { error: `value must be one of: ${HISTORY_VALUES.join(', ')}` }),
});

/**
 * How far back the history goes, and the time that each average covers.
 * Examples: range "-1h", window "10s". At most 6 digits, so the numbers stay in range.
 */
export const historyQuery = z.object({
  range: z.string().regex(/^-[1-9]\d{0,5}(s|m|h|d|w)$/, 'range must look like -1h').optional(),
  window: z.string().regex(/^[1-9]\d{0,5}(s|m|h|d)$/, 'window must look like 10s').optional(),
});

/** How far back, and optionally one kind of state */
export const periodQuery = z.object({
  range: historyQuery.shape.range,
  kind: z.enum(STATE_PERIOD_KINDS, { error: `kind must be one of: ${STATE_PERIOD_KINDS.join(', ')}` }).optional(),
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

/** The computer to unlock in Settings > Logins */
export const unlockSchema = z.object({
  address: z.string({ error: 'address is required' }).trim()
    .min(1, 'address is required')
    .max(MAX_ADDRESS_LENGTH, 'The address is too long'),
}, NOT_AN_OBJECT);

const roleSchema = z.enum(ROLES, { error: 'The role must be "viewer", "operator", or "admin"' });

/** A user that an admin adds on the Users and roles tab */
export const addUserSchema = z.object({ username: usernameSchema, password: passwordSchema, role: roleSchema }, NOT_AN_OBJECT);

export const changeRoleSchema = z.object({ role: roleSchema }, NOT_AN_OBJECT);

/** The new password that an admin sets for a user */
export const setPasswordSchema = z.object({ password: passwordSchema }, NOT_AN_OBJECT);

/** The user in the address, as in /settings/users/12 */
export const userIdParam = z.object({
  id: z.string().regex(/^[1-9]\d{0,15}$/, 'The user id must be a whole number').transform(Number),
});

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
