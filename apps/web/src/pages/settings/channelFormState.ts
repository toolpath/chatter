import { channelFieldLabels, movedChannelSecrets, type AlertSeverity, type ChannelField, type ChannelValues } from '@local-chatter/shared';
import type { ChannelInput, ChannelTypeInfo, NotificationChannel } from '../../api/notifications';

/** What the channel form holds while the admin types. A phone list has one empty box, so the admin can type the first number. */
export interface ChannelFormState {
  type: string;
  name: string;
  values: ChannelValues;
  /** The saved secrets that the admin asked to delete */
  clearSecrets: string[];
  minSeverity: AlertSeverity;
  /** null gets the alerts of all machines */
  machineIds: string[] | null;
  /** One box for each pattern, and one empty box when there are none. The empty boxes are dropped on save. */
  ignorePatterns: string[];
  enabled: boolean;
}

/** The form of a new channel of this type: on, for all machines, with warning and critical alerts */
export function newChannelForm(type: ChannelTypeInfo | undefined): ChannelFormState {
  return {
    type: type?.id ?? '', name: '', values: emptyValuesOf(type?.fields ?? []), clearSecrets: [],
    minSeverity: 'warning', machineIds: null, ignorePatterns: [''], enabled: true,
  };
}

/** The form of a saved channel. Each secret box is empty: an empty secret keeps the saved one. */
export function editChannelForm(channel: NotificationChannel, type: ChannelTypeInfo | undefined): ChannelFormState {
  const { name, settings, minSeverity, machineIds, ignorePatterns, enabled } = channel;
  const values = { ...emptyValuesOf(type?.fields ?? []), ...settings };
  for (const field of type?.fields ?? []) {
    if (field.kind === 'phone-list' && (values[field.key] as string[]).length === 0) values[field.key] = [''];
  }
  return {
    type: channel.type, name, values, clearSecrets: [], minSeverity, machineIds,
    ignorePatterns: ignorePatterns.length > 0 ? [...ignorePatterns] : [''], enabled,
  };
}

/** Another type has other fields, so the values start again. The name and the alert choices stay. */
export function withType(form: ChannelFormState, type: ChannelTypeInfo): ChannelFormState {
  return { ...form, type: type.id, values: emptyValuesOf(type.fields), clearSecrets: [] };
}

/** The body for the server: the texts trimmed and no empty phone or pattern boxes. The server checks the rest. */
export function channelInputOf(form: ChannelFormState): ChannelInput {
  const { type, name, values, minSeverity, machineIds, enabled } = form;
  const ignorePatterns = filledTexts(form.ignorePatterns);
  const input: ChannelInput = { type, name: name.trim(), values: trimmed(values), minSeverity, machineIds, ignorePatterns, enabled };
  // A new secret in the box takes the place of the saved one, so there is nothing to delete
  const clearSecrets = form.clearSecrets.filter(key => input.values[key] === '');
  return clearSecrets.length > 0 ? { ...input, clearSecrets } : input;
}

/**
 * The text for each saved secret that the admin must type again, by the key of its field.
 * The server sends a saved secret only to the address where the admin saved it, so it refuses a save or a test
 * that changes a `url` field and keeps a saved secret. The rule is in the shared package (movedChannelSecrets),
 * and the server uses it too. The server gets the values of channelInputOf.
 */
export function secretsToTypeAgain(form: ChannelFormState, channel: NotificationChannel | undefined, type: ChannelTypeInfo): Record<string, string> {
  if (!channel || channel.type !== type.id) return {};
  const { values, clearSecrets = [] } = channelInputOf(form);
  const moved = movedChannelSecrets(type.fields, values, channel.settings,
    key => channel.hasSecret[key] === true && !clearSecrets.includes(key));
  if (!moved) return {};
  const reason = `You changed the ${channelFieldLabels(moved.changed)}. Chatter does not send a saved secret to a new address.`;
  return Object.fromEntries(moved.kept.map(field => [field.key, `Type the ${channelFieldLabels([field])} again. ${reason}`]));
}

function emptyValuesOf(fields: ChannelField[]): ChannelValues {
  return Object.fromEntries(fields.map(field => [field.key, field.kind === 'phone-list' ? [''] : field.default ?? '']));
}

function trimmed(values: ChannelValues): ChannelValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? filledTexts(value) : value.trim()]));
}

function filledTexts(texts: string[]): string[] {
  return texts.map(text => text.trim()).filter(text => text !== '');
}
