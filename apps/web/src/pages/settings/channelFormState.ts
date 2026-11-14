import type { AlertSeverity, ChannelField, ChannelValues } from '@local-chatter/shared';
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
  enabled: boolean;
}

/** The form of a new channel of this type: on, for all machines, with warning and critical alerts */
export function newChannelForm(type: ChannelTypeInfo | undefined): ChannelFormState {
  return {
    type: type?.id ?? '', name: '', values: emptyValuesOf(type?.fields ?? []), clearSecrets: [],
    minSeverity: 'warning', machineIds: null, enabled: true,
  };
}

/** The form of a saved channel. Each secret box is empty: an empty secret keeps the saved one. */
export function editChannelForm(channel: NotificationChannel, type: ChannelTypeInfo | undefined): ChannelFormState {
  const { name, settings, minSeverity, machineIds, enabled } = channel;
  const values = { ...emptyValuesOf(type?.fields ?? []), ...settings };
  for (const field of type?.fields ?? []) {
    if (field.kind === 'phone-list' && (values[field.key] as string[]).length === 0) values[field.key] = [''];
  }
  return { type: channel.type, name, values, clearSecrets: [], minSeverity, machineIds, enabled };
}

/** Another type has other fields, so the values start again. The name and the alert choices stay. */
export function withType(form: ChannelFormState, type: ChannelTypeInfo): ChannelFormState {
  return { ...form, type: type.id, values: emptyValuesOf(type.fields), clearSecrets: [] };
}

/** The body for the server: the texts trimmed and no empty phone boxes. The server checks the rest. */
export function channelInputOf(form: ChannelFormState): ChannelInput {
  const { type, name, values, minSeverity, machineIds, enabled } = form;
  const input: ChannelInput = { type, name: name.trim(), values: trimmed(values), minSeverity, machineIds, enabled };
  // A new secret in the box takes the place of the saved one, so there is nothing to delete
  const clearSecrets = form.clearSecrets.filter(key => input.values[key] === '');
  return clearSecrets.length > 0 ? { ...input, clearSecrets } : input;
}

function emptyValuesOf(fields: ChannelField[]): ChannelValues {
  return Object.fromEntries(fields.map(field => [field.key, field.kind === 'phone-list' ? [''] : '']));
}

function trimmed(values: ChannelValues): ChannelValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key, Array.isArray(value) ? value.map(entry => entry.trim()).filter(entry => entry !== '') : value.trim(),
  ]));
}
