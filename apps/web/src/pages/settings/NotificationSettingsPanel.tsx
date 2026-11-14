import { useState, type FormEvent } from 'react';
import type { NotificationSettings } from '../../api/notifications';
import { Button } from '../../components/ui/Button';
import { Field, TextInput } from '../../components/ui/fields';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';

interface NotificationSettingsPanelProps {
  settings: NotificationSettings;
  canSave: boolean;
  /** The server's reason when the last save failed */
  error: string | null;
  onSave: (settings: NotificationSettings) => Promise<boolean>;
}

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The time zones that the browser knows, as suggestions for the time zone box */
const TIME_ZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

/**
 * The parts of the message text that Chatter cannot know by itself: the address of Chatter for the links,
 * and the time zone of the shop for the times. The server has no time zone, so the first value comes from this browser.
 */
export function NotificationSettingsPanel({ settings, canSave, error, onSave }: NotificationSettingsPanelProps) {
  const [linkBaseUrl, setLinkBaseUrl] = useState(settings.linkBaseUrl ?? '');
  const [timeZone, setTimeZone] = useState(settings.timeZone ?? browserTimeZone());
  const [isSaved, setIsSaved] = useState(false);
  const isTimeZoneFromBrowser = settings.timeZone === null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaved(await onSave({ linkBaseUrl: linkBaseUrl.trim() || null, timeZone: timeZone.trim() || null }));
  };

  return (
    <Panel title="Message settings" description="These go in the text of each message.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-wrap gap-4">
          <Field
            id="notification-link"
            label="Chatter address for links"
            hint="Each message has a link to the machine page. Leave it blank to send no link."
            className="flex-[1_1_18rem]"
          >
            <TextInput
              id="notification-link"
              mono
              value={linkBaseUrl}
              onChange={event => { setLinkBaseUrl(event.target.value); setIsSaved(false); }}
              placeholder="http://chatter.local:3001"
              aria-describedby="notification-link-hint"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field
            id="notification-time-zone"
            label="Time zone"
            hint={isTimeZoneFromBrowser ? 'Chatter got this time zone from this browser. Save to use it.' : 'The times in the messages use this time zone.'}
            className="flex-[1_1_14rem]"
          >
            <TextInput
              id="notification-time-zone"
              value={timeZone}
              onChange={event => { setTimeZone(event.target.value); setIsSaved(false); }}
              list="notification-time-zones"
              aria-describedby="notification-time-zone-hint"
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id="notification-time-zones">
              {TIME_ZONES.map(zone => <option key={zone} value={zone} />)}
            </datalist>
          </Field>
        </div>
        {error && <Notice tone="error" title={error} />}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={!canSave}>Save settings</Button>
          {isSaved && <span role="status" className="text-xs text-zinc-300">Saved.</span>}
        </div>
      </form>
    </Panel>
  );
}
