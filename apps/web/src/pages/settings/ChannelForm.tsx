import { useState, type FormEvent } from 'react';
import {
  sendTestMessage, type ChannelInput, type ChannelTestResult, type ChannelTypeInfo, type NotificationChannel,
} from '../../api/notifications';
import { Button } from '../../components/ui/Button';
import { CloseButton } from '../../components/ui/CloseButton';
import { Field, SelectInput, TextInput } from '../../components/ui/fields';
import { Notice } from '../../components/ui/Notice';
import { SidePanel } from '../../components/ui/SidePanel';
import { useSlideOut } from '../../components/ui/useSlideOut';
import { errorMessageOf } from '../../utils/errorMessage';
import { AlertChoiceFields } from './AlertChoiceFields';
import { ChannelFields } from './ChannelFields';
import { channelInputOf, editChannelForm, newChannelForm, withType, type ChannelFormState } from './channelFormState';
import type { MachineName } from './notificationLabels';

interface ChannelFormProps {
  types: ChannelTypeInfo[];
  machines: MachineName[];
  /** The saved channel to change. Without it, the form adds a channel. */
  channel?: NotificationChannel;
  /** The server's reason when the last save failed */
  error: string | null;
  isSaving: boolean;
  /** Returns true when the server saved the channel. The form then closes. */
  onSave: (input: ChannelInput) => Promise<boolean>;
  /** After the admin confirms in the form. Returns true when the server deleted the channel. The form then closes. */
  onDelete: () => Promise<boolean>;
  /** A test of a saved channel goes in the message list, so the tab loads it again */
  onTested: () => void;
  onClose: () => void;
}

/** The side panel to add or change a channel. Its inputs come from the fields of the channel type. */
export function ChannelForm({ types, machines, channel, error, isSaving, onSave, onDelete, onTested, onClose }: ChannelFormProps) {
  const typeOf = (id: string) => types.find(type => type.id === id);
  const [form, setForm] = useState<ChannelFormState>(() => (channel ? editChannelForm(channel, typeOf(channel.type)) : newChannelForm(types[0])));
  const { isClosing, close } = useSlideOut(onClose);
  const test = useChannelTest(channel?.id, onTested);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const title = channel ? `Edit ${channel.name}` : 'Add channel';
  const type = typeOf(form.type);
  // A close during a save would lose the form
  const closeUnlessSaving = isSaving ? () => {} : close;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSave(channelInputOf(form))) close();
  };
  const confirmDelete = async () => {
    setIsConfirmingDelete(false);
    if (await onDelete()) close();
  };
  const changeType = (id: string) => {
    const picked = typeOf(id);
    if (picked) setForm(withType(form, picked));
  };

  return (
    <SidePanel label={title} isClosing={isClosing} onClose={closeUnlessSaving} widthClassName="w-[min(36rem,100vw)]">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
          <h2 className="m-0 text-base font-bold">{title}</h2>
          <CloseButton onClick={closeUnlessSaving} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <Field id="channel-type" label="Type">
            <SelectInput id="channel-type" value={form.type} disabled={channel !== undefined} onChange={event => changeType(event.target.value)}>
              {types.map(known => <option key={known.id} value={known.id}>{known.name}</option>)}
              {!type && <option value={form.type}>{form.type}</option>}
            </SelectInput>
          </Field>
          {!type && <Notice tone="error" title="This version of Chatter does not know this channel type">You can only delete the channel.</Notice>}
          <Field id="channel-name" label="Name">
            <TextInput id="channel-name" value={form.name} placeholder="Shop phones" onChange={event => setForm({ ...form, name: event.target.value })} />
          </Field>
          {type && <ChannelFields type={type} form={form} hasSecret={channel?.hasSecret ?? {}} onChange={setForm} />}
          {type?.note && <Notice tone="info" title={`About ${type.name}`}>{type.note}</Notice>}
          <AlertChoiceFields form={form} machines={machines} onChange={setForm} />
        </div>
        <div className="flex flex-col gap-3 border-t border-zinc-800 px-5 py-4">
          {error && <Notice tone="error" title={error} />}
          {test.result && <TestResultNotice result={test.result} />}
          {channel && isConfirmingDelete ? (
            <DeleteConfirmation name={channel.name} onKeep={() => setIsConfirmingDelete(false)} onDelete={confirmDelete} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={test.isSending || isSaving || !type} onClick={() => test.send(channelInputOf(form))}>
                {test.isSending ? 'Sending…' : 'Send test'}
              </Button>
              {channel && <Button variant="danger" disabled={isSaving} onClick={() => setIsConfirmingDelete(true)}>Delete channel</Button>}
              <span className="flex-1" />
              <Button disabled={isSaving} onClick={close}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={isSaving || !type}>{isSaving ? 'Saving…' : 'Save channel'}</Button>
            </div>
          )}
        </div>
      </form>
    </SidePanel>
  );
}

/** "Send test" of the form. With a saved channel, an empty secret uses the saved one, and the result goes in the message list. */
function useChannelTest(savedId: string | undefined, onTested: () => void) {
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<ChannelTestResult | null>(null);

  const send = async (input: ChannelInput) => {
    setIsSending(true);
    setResult(null);
    try {
      setResult(await sendTestMessage(input, savedId));
    } catch (error) {
      setResult({ ok: false, error: errorMessageOf(error, 'Could not send the test') });
    } finally {
      setIsSending(false);
    }
    if (savedId !== undefined) onTested();
  };
  return { isSending, result, send };
}

interface DeleteConfirmationProps {
  name: string;
  onKeep: () => void;
  onDelete: () => void;
}

/**
 * The confirm step of a delete, in the form. A confirm box of the page would open under the side panel,
 * because the side panel is a modal dialog. "Keep" leaves the form as it is, with each change that is not saved.
 */
function DeleteConfirmation({ name, onKeep, onDelete }: DeleteConfirmationProps) {
  return (
    <div role="group" aria-label="Delete the channel" className="flex flex-wrap items-center gap-2">
      <span className="flex-1 text-sm">Delete {name}? Chatter stops sending to it. Its old messages stay in the list.</span>
      <Button onClick={onKeep}>Keep the channel</Button>
      <Button variant="danger" onClick={onDelete}>Delete the channel</Button>
    </div>
  );
}

function TestResultNotice({ result }: { result: ChannelTestResult }) {
  return result.ok
    ? <Notice tone="success" title="Test sent">{result.detail}</Notice>
    : <Notice tone="error" title="Test failed">{result.error}</Notice>;
}
