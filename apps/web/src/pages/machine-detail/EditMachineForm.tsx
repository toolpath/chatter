import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Button } from '../../components/ui/Button';
import { Field, SelectInput, TextInput } from '../../components/ui/fields';
import { CloseIcon, PlusIcon } from '../../components/ui/icons';
import { AGENT_MAKERS } from '../../machines/machineStatus';
import type { MacroConfig, MachineType, OpcUaSecurity } from '../../types';
import { DEFAULT_MTCONNECT_PORT } from '../../types';
import { DEFAULT_PORTS, ftpPasswordHint, opcuaPasswordHint, type EditFormState } from './editForm';

interface EditMachineFormProps {
  machineType: MachineType;
  /** The server says only whether an FTP password is saved, never the password */
  hasFtpPassword: boolean;
  /** The same for the OPC UA password of a Siemens machine */
  hasOpcuaPassword?: boolean;
  form: EditFormState;
  setForm: Dispatch<SetStateAction<EditFormState>>;
}

type FieldSetter = (field: keyof EditFormState, value: string | number | boolean) => void;

/** The typed port, or the default port when the box is empty or not a number */
function portOrDefault(text: string, defaultPort: number): number {
  return parseInt(text) || defaultPort;
}

function updateAt<T>(list: T[], index: number, change: (entry: T) => T): T[] {
  return list.map((entry, i) => (i === index ? change(entry) : entry));
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return updateAt(list, index, () => value);
}

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** The settings of a machine. Each machine type shows its own fields. */
function EditMachineForm({ machineType, hasFtpPassword, hasOpcuaPassword = false, form, setForm }: EditMachineFormProps) {
  const setField: FieldSetter = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <>
      <FieldGroup legend="Connection">
        <TextField id="edit-name" label="Machine name" value={form.name} onChange={value => setField('name', value)} />
        <TextField id="edit-host" label="IP address" mono value={form.host} onChange={value => setField('host', value)} />
        {(machineType === 'brother' || machineType === 'haas') && (
          <BrotherOrHaasPorts machineType={machineType} form={form} setField={setField} />
        )}
        {machineType === 'mtconnect' && <MTConnectFields form={form} setField={setField} />}
        {machineType === 'fanuc' && (
          <NumberField
            id="edit-focas-port"
            label="FOCAS port"
            value={form.focasPort}
            onChange={text => setField('focasPort', portOrDefault(text, DEFAULT_PORTS.focas))}
          />
        )}
        {machineType === 'siemens' && <SiemensConnectionFields form={form} setField={setField} />}
      </FieldGroup>
      {machineType === 'siemens' && (
        <FieldGroup legend="OPC UA login">
          <TextField
            id="edit-opcua-user"
            label="OPC UA username (empty: anonymous)"
            value={form.opcuaUser}
            onChange={value => setField('opcuaUser', value)}
            placeholder="OpcUaClient"
            autoComplete="off"
          />
          <PasswordField
            id="edit-opcua-password"
            label="OPC UA password"
            value={form.opcuaPassword}
            onChange={value => setField('opcuaPassword', value)}
            hint={opcuaPasswordHint(form, hasOpcuaPassword)}
            hasSavedPassword={hasOpcuaPassword}
            isRemoving={form.removeOpcuaPassword}
            onToggleRemove={() => setField('removeOpcuaPassword', !form.removeOpcuaPassword)}
          />
        </FieldGroup>
      )}
      <FieldGroup legend="FTP login">
        <NumberField
          id="edit-ftp-port"
          label="FTP port"
          value={form.ftpPort}
          onChange={text => setField('ftpPort', portOrDefault(text, DEFAULT_PORTS.ftp))}
        />
        <FtpLoginFields form={form} setField={setField} hasFtpPassword={hasFtpPassword} />
      </FieldGroup>
      {machineType === 'fanuc' && <FanucFields form={form} setForm={setForm} setField={setField} />}
      <MacroList
        isSiemens={machineType === 'siemens'}
        macros={form.macros}
        setMacros={change => setForm(prev => ({ ...prev, macros: change(prev.macros) }))}
      />
    </>
  );
}

function FieldGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] gap-3.5 border-0 p-0">
      <legend className="mb-2.5 p-0 font-bold">{legend}</legend>
      {children}
    </fieldset>
  );
}

interface FieldsProps {
  form: EditFormState;
  setField: FieldSetter;
}

function BrotherOrHaasPorts({ machineType, form, setField }: FieldsProps & { machineType: 'brother' | 'haas' }) {
  const defaultDataPort = machineType === 'brother' ? DEFAULT_PORTS.brotherData : DEFAULT_PORTS.haasData;
  return (
    <>
      <NumberField
        id="edit-data-port"
        label="Data port"
        value={form.dataPort}
        onChange={text => setField('dataPort', portOrDefault(text, defaultDataPort))}
      />
      {machineType === 'haas' && (
        <NumberField
          id="edit-query-port"
          label="Query port"
          value={form.queryPort}
          onChange={text => setField('queryPort', portOrDefault(text, DEFAULT_PORTS.haasQuery))}
        />
      )}
    </>
  );
}

function MTConnectFields({ form, setField }: FieldsProps) {
  return (
    <>
      <NumberField
        id="edit-mtconnect-port"
        label="MTConnect port"
        value={form.mtConnectPort}
        onChange={text => setField('mtConnectPort', portOrDefault(text, DEFAULT_MTCONNECT_PORT))}
      />
      <TextField
        id="edit-device-id"
        label="Device ID (you can leave it empty)"
        value={form.mtConnectDeviceId}
        onChange={value => setField('mtConnectDeviceId', value)}
        placeholder="For an agent with many machines"
      />
      <Field id="edit-agent-type" label="Agent type">
        <SelectInput id="edit-agent-type" value={form.agentType} onChange={event => setField('agentType', event.target.value)}>
          {Object.entries(AGENT_MAKERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectInput>
      </Field>
    </>
  );
}

/** The words for each OPC UA security mode */
const OPCUA_SECURITY_LABELS: Record<OpcUaSecurity, string> = {
  none: 'None',
  signAndEncrypt: 'Sign and encrypt (Basic256Sha256)',
};

function SiemensConnectionFields({ form, setField }: FieldsProps) {
  return (
    <>
      <NumberField
        id="edit-opcua-port"
        label="OPC UA port"
        value={form.opcuaPort}
        onChange={text => setField('opcuaPort', portOrDefault(text, DEFAULT_PORTS.opcua))}
      />
      <Field
        id="edit-opcua-security"
        label="Security"
        hint={form.opcuaSecurity === 'signAndEncrypt'
          ? 'Trust the Chatter certificate on the control once: Commissioning > Network > OPC UA > Certificates.'
          : undefined}
      >
        <SelectInput
          id="edit-opcua-security"
          value={form.opcuaSecurity}
          onChange={event => setField('opcuaSecurity', event.target.value)}
          aria-describedby={form.opcuaSecurity === 'signAndEncrypt' ? 'edit-opcua-security-hint' : undefined}
        >
          {Object.entries(OPCUA_SECURITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectInput>
      </Field>
    </>
  );
}

function FanucFields({ form, setForm, setField }: FieldsProps & { setForm: EditMachineFormProps['setForm'] }) {
  const setIgnoredTypes = (change: (types: string[]) => string[]) => {
    setForm(prev => ({ ...prev, ignoredMessageTypes: change(prev.ignoredMessageTypes) }));
  };

  return (
    <FieldGroup legend="FANUC values">
      <NumberField
        id="edit-tool-number-variable"
        label="Tool number variable"
        value={form.toolNumberVariable}
        onChange={text => setField('toolNumberVariable', text)}
        placeholder="500"
      />
      <NumberField
        id="edit-part-counter-variable"
        label="Part counter variable"
        value={form.partCounterVariable}
        onChange={text => setField('partCounterVariable', text)}
        placeholder="501"
      />
      <div className="col-span-full flex flex-col gap-2">
        <span className="text-xs font-semibold text-zinc-300">Operator message types to ignore</span>
        {form.ignoredMessageTypes.map((messageType, index) => (
          <div key={index} className="flex gap-2">
            <TextInput
              aria-label={`Ignored message type ${index + 1}`}
              value={messageType}
              onChange={event => {
                const text = event.target.value;
                setIgnoredTypes(types => replaceAt(types, index, text));
              }}
              placeholder="Type number"
              className="w-40"
            />
            <RemoveButton label={`Remove ignored type ${index + 1}`} onClick={() => setIgnoredTypes(types => removeAt(types, index))} />
          </div>
        ))}
        <AddButton onClick={() => setIgnoredTypes(types => [...types, ''])}>Add a message type</AddButton>
      </div>
    </FieldGroup>
  );
}

interface MacroListProps {
  /** On a Siemens control, the values are R parameters */
  isSiemens: boolean;
  macros: MacroConfig[];
  setMacros: (change: (macros: MacroConfig[]) => MacroConfig[]) => void;
}

function MacroList({ isSiemens, macros, setMacros }: MacroListProps) {
  const changeMacro = (index: number, field: 'location' | 'name', value: string | number) => {
    setMacros(prev => updateAt(prev, index, macro => ({ ...macro, [field]: value }) as MacroConfig));
  };

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 font-bold">{isSiemens ? 'R parameters' : 'Macro variables'}</legend>
      <p className="m-0 text-xs text-zinc-300">
        The Current job card shows the value of each one.{isSiemens && ' Type the number of the R parameter: 5 reads R5.'}
      </p>
      {macros.map((macro, index) => (
        <div key={index} className="flex flex-wrap gap-2">
          <TextInput
            type="number"
            aria-label={`Macro ${index + 1} location`}
            value={macro.location}
            onChange={event => changeMacro(index, 'location', event.target.value === '' ? '' : parseInt(event.target.value))}
            placeholder="Location"
            mono
            className="w-32"
          />
          <TextInput
            aria-label={`Macro ${index + 1} name`}
            value={macro.name || ''}
            onChange={event => changeMacro(index, 'name', event.target.value)}
            placeholder="Name (you can leave it empty)"
            className="min-w-48 flex-1"
          />
          <RemoveButton label={`Remove macro ${index + 1}`} onClick={() => setMacros(prev => removeAt(prev, index))} />
        </div>
      ))}
      <AddButton onClick={() => setMacros(prev => [...prev, emptyMacroRow()])}>
        {isSiemens ? 'Add an R parameter' : 'Add a macro variable'}
      </AddButton>
    </fieldset>
  );
}

/** A new macro row. The location starts empty, so the user types it, and it is not sent until then. */
function emptyMacroRow(): MacroConfig {
  return { location: '' as unknown as number, name: '' };
}

function FtpLoginFields({ form, setField, hasFtpPassword }: FieldsProps & { hasFtpPassword: boolean }) {
  return (
    <>
      <TextField
        id="edit-ftp-user"
        label="FTP username"
        value={form.ftpUser}
        onChange={value => setField('ftpUser', value)}
        placeholder="anonymous"
        autoComplete="off"
      />
      <PasswordField
        id="edit-ftp-password"
        label="FTP password"
        value={form.ftpPassword}
        onChange={value => setField('ftpPassword', value)}
        hint={ftpPasswordHint(form, hasFtpPassword)}
        hasSavedPassword={hasFtpPassword}
        isRemoving={form.removeFtpPassword}
        onToggleRemove={() => setField('removeFtpPassword', !form.removeFtpPassword)}
      />
    </>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
  /** The server says only whether a password is saved, never the password */
  hasSavedPassword: boolean;
  isRemoving: boolean;
  onToggleRemove: () => void;
}

/** A password box that keeps the saved password when it is left empty, with a "Remove password" link */
function PasswordField({ id, label, value, onChange, hint, hasSavedPassword, isRemoving, onToggleRemove }: PasswordFieldProps) {
  return (
    <Field
      id={id}
      label={label}
      hint={
        <>
          {hint}{' '}
          {hasSavedPassword && (
            <button
              type="button"
              className="border-0 bg-transparent p-0 font-semibold text-primary-text underline-offset-2 hover:underline"
              onClick={onToggleRemove}
            >
              {isRemoving ? 'Keep password' : 'Remove password'}
            </button>
          )}
        </>
      }
    >
      <TextInput
        id={id}
        type="password"
        // Stops the browser from filling in the ChatterBox login password
        autoComplete="new-password"
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
      />
    </Field>
  );
}

interface InputFieldProps {
  id: string;
  label: string;
  value: string | number;
  onChange: (text: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  autoComplete?: string;
  mono?: boolean;
}

function TextField({ id, label, value, onChange, placeholder, type = 'text', autoComplete, mono }: InputFieldProps) {
  return (
    <Field id={id} label={label}>
      <TextInput
        id={id}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        mono={mono}
      />
    </Field>
  );
}

function NumberField(props: Omit<InputFieldProps, 'type' | 'mono'>) {
  return <TextField {...props} type="number" mono />;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="icon" variant="quiet" aria-label={label} title="Remove" onClick={onClick}>
      <CloseIcon size={14} />
    </Button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="quiet" onClick={onClick} className="self-start px-1.5 text-primary-text hover:text-primary-text-hover">
      <PlusIcon size={14} /> {children}
    </Button>
  );
}

export default EditMachineForm;
