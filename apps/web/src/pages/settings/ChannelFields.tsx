import type { ChannelField } from '@local-chatter/shared';
import type { ChannelTypeInfo } from '../../api/notifications';
import { Button } from '../../components/ui/Button';
import { Field, TextInput } from '../../components/ui/fields';
import { CloseIcon, PlusIcon } from '../../components/ui/icons';
import type { ChannelFormState } from './channelFormState';

const SAVED_SECRET_PLACEHOLDER = 'Saved. Leave it empty to keep it.';

interface ChannelFieldsProps {
  type: ChannelTypeInfo;
  form: ChannelFormState;
  /** True for each secret field that has a saved value */
  hasSecret: Record<string, boolean>;
  onChange: (form: ChannelFormState) => void;
}

/** The inputs that the channel type asks for, in its order. Each type gives its own list, so a new service needs no new form. */
export function ChannelFields({ type, form, hasSecret, onChange }: ChannelFieldsProps) {
  const setValue = (key: string, value: string | string[]) => onChange({ ...form, values: { ...form.values, [key]: value } });
  const setClearSecret = (key: string, clear: boolean) => onChange({
    ...form, clearSecrets: clear ? [...form.clearSecrets, key] : form.clearSecrets.filter(entry => entry !== key),
  });

  return (
    <>
      {type.fields.map(field => {
        const value = form.values[field.key];
        switch (field.kind) {
          case 'phone-list':
            return <PhoneListField key={field.key} field={field} phones={asList(value)} onChange={phones => setValue(field.key, phones)} />;
          case 'secret':
            return (
              <SecretField
                key={field.key}
                field={field}
                value={asText(value)}
                isSaved={hasSecret[field.key] === true}
                isCleared={form.clearSecrets.includes(field.key)}
                onChange={text => setValue(field.key, text)}
                onClearChange={clear => setClearSecret(field.key, clear)}
              />
            );
          default:
            return <TextField key={field.key} field={field} value={asText(value)} onChange={text => setValue(field.key, text)} />;
        }
      })}
    </>
  );
}

const asText = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
const asList = (value: string | string[] | undefined) => (Array.isArray(value) && value.length > 0 ? value : ['']);
const idOf = (field: ChannelField) => `channel-${field.key}`;
const hintIdOf = (field: ChannelField) => (field.hint ? `${idOf(field)}-hint` : undefined);

interface TextFieldProps {
  field: ChannelField;
  value: string;
  onChange: (value: string) => void;
}

function TextField({ field, value, onChange }: TextFieldProps) {
  return (
    <Field id={idOf(field)} label={field.label} hint={field.hint}>
      <TextInput
        id={idOf(field)}
        mono={field.mono}
        value={value}
        inputMode={field.kind === 'url' ? 'url' : undefined}
        onChange={event => onChange(event.target.value)}
        aria-describedby={hintIdOf(field)}
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
}

interface SecretFieldProps extends TextFieldProps {
  isSaved: boolean;
  isCleared: boolean;
  onClearChange: (clear: boolean) => void;
}

/** The server never sends a secret back. An empty box keeps the saved secret, and a secret that is not necessary can be deleted. */
function SecretField({ field, value, isSaved, isCleared, onChange, onClearChange }: SecretFieldProps) {
  const canClear = isSaved && !field.required;
  return (
    <Field id={idOf(field)} label={field.label} hint={field.hint}>
      <TextInput
        id={idOf(field)}
        type="password"
        mono={field.mono}
        value={value}
        placeholder={isSaved && !isCleared ? SAVED_SECRET_PLACEHOLDER : undefined}
        onChange={event => onChange(event.target.value)}
        aria-describedby={hintIdOf(field)}
        autoComplete="new-password"
        spellCheck={false}
      />
      {canClear && (
        <label className="flex items-center gap-2 text-xs text-zinc-200">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={isCleared}
            disabled={value !== ''}
            onChange={event => onClearChange(event.target.checked)}
          />
          Delete the saved secret
        </label>
      )}
    </Field>
  );
}

interface PhoneListFieldProps {
  field: ChannelField;
  phones: string[];
  onChange: (phones: string[]) => void;
}

function PhoneListField({ field, phones, onChange }: PhoneListFieldProps) {
  const setPhone = (index: number, phone: string) => onChange(phones.map((entry, at) => (at === index ? phone : entry)));
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-xs font-semibold text-zinc-300">{field.label}</legend>
      {phones.map((phone, index) => (
        // The boxes have no id of their own, so the place in the list is the key
        <div key={index} className="flex items-center gap-2">
          <TextInput
            type="tel"
            mono={field.mono}
            className="flex-1"
            value={phone}
            placeholder="+15551234567"
            aria-label={`Phone number ${index + 1}`}
            onChange={event => setPhone(index, event.target.value)}
            autoComplete="off"
          />
          {phones.length > 1 && (
            <Button
              variant="quiet"
              size="icon"
              aria-label={`Remove phone number ${index + 1}`}
              onClick={() => onChange(phones.filter((_, at) => at !== index))}
            >
              <CloseIcon size={14} />
            </Button>
          )}
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => onChange([...phones, ''])}><PlusIcon /> Add a number</Button>
      </div>
      {field.hint && <p className="m-0 text-xs text-zinc-300">{field.hint}</p>}
    </fieldset>
  );
}
