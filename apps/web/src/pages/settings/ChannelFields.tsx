import type { ChannelField } from '@local-chatter/shared';
import { useState, type ReactNode } from 'react';
import type { ChannelTypeInfo } from '../../api/notifications';
import { Button } from '../../components/ui/Button';
import { Field, SelectInput, TextInput } from '../../components/ui/fields';
import type { ChannelFormState } from './channelFormState';
import { randomWords } from './randomWords';
import { TextList } from './TextList';

const SAVED_SECRET_PLACEHOLDER = 'Saved. Leave it empty to keep it.';

interface ChannelFieldsProps {
  type: ChannelTypeInfo;
  form: ChannelFormState;
  /** True for each secret field that has a saved value */
  hasSecret: Record<string, boolean>;
  /** The text for each saved secret that the admin must type again, because the form changes an address */
  typeAgain: Record<string, string>;
  onChange: (form: ChannelFormState) => void;
}

/** The inputs that the channel type asks for, in its order. Each type gives its own list, so a new service needs no new form. */
export function ChannelFields({ type, form, hasSecret, typeAgain, onChange }: ChannelFieldsProps) {
  const setValue = (key: string, value: string | string[]) => onChange({ ...form, values: { ...form.values, [key]: value } });
  const setClearSecret = (key: string, clear: boolean) => onChange({
    ...form, clearSecrets: clear ? [...form.clearSecrets, key] : form.clearSecrets.filter(entry => entry !== key),
  });

  const fieldOf = (field: ChannelField) => {
        const value = form.values[field.key];
        switch (field.kind) {
          case 'phone-list':
            return <PhoneListField key={field.key} field={field} phones={asList(value)} onChange={phones => setValue(field.key, phones)} />;
          case 'choice':
            return <ChoiceField key={field.key} field={field} value={asText(value)} onChange={text => setValue(field.key, text)} />;
          case 'secret':
            return (
              <SecretField
                key={field.key}
                field={field}
                value={asText(value)}
                isSaved={hasSecret[field.key] === true}
                isCleared={form.clearSecrets.includes(field.key)}
                typeAgain={typeAgain[field.key]}
                onChange={text => setValue(field.key, text)}
                onClearChange={clear => setClearSecret(field.key, clear)}
              />
            );
          default:
            return <TextField key={field.key} field={field} value={asText(value)} onChange={text => setValue(field.key, text)} />;
        }
  };

  const basic = type.fields.filter(field => !field.advanced);
  const advanced = type.fields.filter(field => field.advanced);
  // A saved value in an advanced field opens the heading, so the admin sees it
  const hasAdvancedValue = advanced.some(field => hasSecret[field.key] === true || asText(form.values[field.key]).trim() !== '');
  return (
    <>
      {basic.map(fieldOf)}
      {advanced.length > 0 && (
        // A new type has other advanced fields, so the heading starts again
        <AdvancedGroup key={type.id} startOpen={hasAdvancedValue}>{advanced.map(fieldOf)}</AdvancedGroup>
      )}
    </>
  );
}

/** The fields that most admins leave empty, under a heading that opens and closes */
function AdvancedGroup({ startOpen, children }: { startOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <details open={open} className="flex flex-col gap-4">
      <summary
        className="cursor-pointer select-none text-xs font-semibold text-zinc-300"
        onClick={event => { event.preventDefault(); setOpen(!open); }}
      >
        Advanced
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/** A button that fills the box with three random words, for a field with `generate` */
function GenerateButton({ field, onChange }: { field: ChannelField; onChange: (value: string) => void }) {
  return <Button size="sm" onClick={() => onChange(randomWords())}>Make a random {field.label.toLowerCase()}</Button>;
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
      <div className="flex items-center gap-2">
        <TextInput
          id={idOf(field)}
          mono={field.mono}
          className="flex-1"
          value={value}
          inputMode={field.kind === 'url' ? 'url' : undefined}
          onChange={event => onChange(event.target.value)}
          aria-describedby={hintIdOf(field)}
          autoComplete="off"
          spellCheck={false}
        />
        {field.generate && <GenerateButton field={field} onChange={onChange} />}
      </div>
    </Field>
  );
}

/** A select of the options of the field. An empty value, for example of a channel saved before the field was there, shows the default. */
function ChoiceField({ field, value, onChange }: TextFieldProps) {
  const options = field.options ?? [];
  return (
    <Field id={idOf(field)} label={field.label} hint={field.hint}>
      <SelectInput
        id={idOf(field)}
        value={value || field.default || options[0]?.value || ''}
        aria-describedby={hintIdOf(field)}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectInput>
    </Field>
  );
}

interface SecretFieldProps extends TextFieldProps {
  isSaved: boolean;
  isCleared: boolean;
  /** The server refuses the form until the admin types the saved secret again or deletes it */
  typeAgain?: string;
  onClearChange: (clear: boolean) => void;
}

/** The server never sends a secret back. An empty box keeps the saved secret, and a secret that is not necessary can be deleted. */
function SecretField({ field, value, isSaved, isCleared, typeAgain, onChange, onClearChange }: SecretFieldProps) {
  const canClear = isSaved && !field.required;
  const typeAgainId = `${idOf(field)}-again`;
  // The box is described by both texts, so a screen reader also tells to type the secret again
  const describedBy = [hintIdOf(field), typeAgain && typeAgainId].filter(Boolean).join(' ') || undefined;
  return (
    <Field id={idOf(field)} label={field.label} hint={field.hint}>
      <TextInput
        id={idOf(field)}
        type="password"
        mono={field.mono}
        value={value}
        placeholder={isSaved && !isCleared && !typeAgain ? SAVED_SECRET_PLACEHOLDER : undefined}
        onChange={event => onChange(event.target.value)}
        aria-describedby={describedBy}
        // new-password stops a browser from filling in a saved login
        autoComplete="new-password"
        spellCheck={false}
      />
      {typeAgain && <p id={typeAgainId} className="m-0 text-xs font-semibold text-primary-text">{typeAgain}</p>}
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
  return (
    <TextList
      legend={field.label}
      values={phones}
      onChange={onChange}
      itemLabel="Phone number"
      addLabel="Add a number"
      inputType="tel"
      placeholder="+15551234567"
      mono={field.mono}
      hint={field.hint}
    />
  );
}
