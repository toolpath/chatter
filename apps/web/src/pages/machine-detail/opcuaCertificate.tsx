import { Dialog } from '@toolpath/ui';
import { Fragment, useRef, useState, type ReactElement } from 'react';
import { useCan } from '../../components/CurrentUser';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import { forgetOpcuaCertificate } from '../../api/machines';
import type { Machine } from '../../types';
import { errorMessageOf } from '../../utils/errorMessage';

/** The OPC UA certificate of a Siemens control: its thumbprints, and the confirm boxes to trust or forget it (F-11) */

export const TRUSTED_TEXT = 'Chatter trusts the new certificate. It connects to the control again now.';
const FORGOTTEN_TEXT = 'Chatter forgot the saved certificate. It connects to the control again now.';

/**
 * A thumbprint as openssl and most screens write it: upper case pairs with colons, for example "AB:CD:EF".
 * The line can wrap after each colon, so a long thumbprint fits on a phone.
 */
function Thumbprint({ hex }: { hex: string }) {
  const pairs = hex.toUpperCase().match(/.{1,2}/g) ?? [];
  return (
    <code className="font-mono text-[0.8125rem] text-zinc-50">
      {pairs.map((pair, index) => (
        <Fragment key={index}>
          {pair}
          {index < pairs.length - 1 && <>:<wbr /></>}
        </Fragment>
      ))}
    </code>
  );
}

/** The SHA-256 and the SHA-1 thumbprint of one certificate, one under the other */
export function ThumbprintList({ sha256, sha1 }: { sha256: string; sha1: string | null }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-xs font-semibold text-zinc-200">SHA-256</dt>
      <dd className="m-0"><Thumbprint hex={sha256} /></dd>
      {sha1 && (
        <>
          <dt className="text-xs font-semibold text-zinc-200">SHA-1</dt>
          <dd className="m-0"><Thumbprint hex={sha1} /></dd>
        </>
      )}
    </dl>
  );
}

/** The result of the last action, for the Notice under the button */
interface ActionResult {
  isDone: boolean;
  text: string;
}

/**
 * Asks with a confirm box, then runs the action. It keeps the result, and gives the new status of the machine.
 * On an error it calls `onError`, for example to load the status again.
 */
export function useConfirmedAction() {
  const { confirm } = Dialog.useDialog();
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  // The dialog provider keeps the last box. A new key for each opening starts the box again.
  const openings = useRef(0);
  // The provider has one box. A second confirm while a box is open would replace it, and the first one never ends.
  const isAsking = useRef(false);

  const run = async (
    box: ReactElement,
    action: () => Promise<Machine>,
    doneText: string,
    onError?: () => Promise<void>,
  ): Promise<Machine | null> => {
    if (isAsking.current) return null;
    isAsking.current = true;
    openings.current += 1;
    try {
      if (!await confirm(<Fragment key={openings.current}>{box}</Fragment>)) return null;
    } finally {
      isAsking.current = false;
    }
    setIsBusy(true);
    setResult(null);
    try {
      const status = await action();
      setResult({ isDone: true, text: doneText });
      return status;
    } catch (error) {
      setResult({ isDone: false, text: errorMessageOf(error, 'The action failed') });
      await onError?.();
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  return { run, isBusy, result, clearResult: () => setResult(null) };
}

/** Shows the result of the last action. The user can close it. */
export function ActionResultNotice({ result, onClose }: { result: ActionResult | null; onClose: () => void }) {
  if (!result) return null;
  return <Notice tone={result.isDone ? 'success' : 'error'} title={result.text} onClose={onClose} />;
}

/** The confirm box before an Admin trusts a new certificate. It repeats the thumbprints that Chatter sends. */
export function TrustCertificateDialog({ sha256, sha1 }: { sha256: string; sha1: string | null }) {
  return (
    <Dialog variant="danger">
      <Dialog.Title>Trust the new certificate?</Dialog.Title>
      <Dialog.Message>
        Compare these thumbprints with the certificate on the control: Commissioning &gt; Network &gt; OPC UA &gt; Certificates.
        Trust it only when a thumbprint is the same. Then Chatter sends the OPC UA login to the device that shows this certificate.
        <div className="pt-3">
          <ThumbprintList sha256={sha256} sha1={sha1} />
        </div>
      </Dialog.Message>
      <Dialog.Actions>
        <Dialog.Dismiss>Cancel</Dialog.Dismiss>
        <Dialog.Confirm>Trust this certificate</Dialog.Confirm>
      </Dialog.Actions>
    </Dialog>
  );
}

/** The confirm box before an Admin forgets the trusted certificate */
function ForgetCertificateDialog({ host }: { host: string }) {
  return (
    <Dialog variant="danger">
      <Dialog.Title>Forget the saved certificate?</Dialog.Title>
      <Dialog.Message>
        Chatter connects to the control again at once. If the control shows a certificate then, Chatter trusts it, as the first
        connect does. If the control shows no certificate, Chatter trusts nothing. Then a login with a username and Security
        None stays offline. First make sure that the device at {host} is your control.
      </Dialog.Message>
      <Dialog.Actions>
        <Dialog.Dismiss>Cancel</Dialog.Dismiss>
        <Dialog.Confirm>Forget the certificate</Dialog.Confirm>
      </Dialog.Actions>
    </Dialog>
  );
}

interface ForgetCertificateButtonProps {
  machine: Machine;
  run: ReturnType<typeof useConfirmedAction>['run'];
  isBusy: boolean;
  onStatus: (status: Machine) => void;
}

/** The Admin button that forgets the trusted certificate, after a confirm */
export function ForgetCertificateButton({ machine, run, isBusy, onStatus }: ForgetCertificateButtonProps) {
  const forget = async () => {
    const status = await run(<ForgetCertificateDialog host={machine.host} />, () => forgetOpcuaCertificate(machine.id), FORGOTTEN_TEXT);
    if (status) onStatus(status);
  };
  return <Button size="sm" onClick={forget} disabled={isBusy}>Forget the saved certificate</Button>;
}

/**
 * The status of the machine with the reply of the last action, until the server sends a newer status.
 * A reply replaces the status that is shown when the reply comes, also when a new status came while the confirm box
 * was open. A new machine prop (a new object) that comes after the reply wins over the reply.
 */
export function useStatusWithReply(machine: Machine): [Machine, (status: Machine) => void] {
  const [reply, setReply] = useState<Machine | null>(null);
  const [replyBasedOn, setReplyBasedOn] = useState(machine);
  if (replyBasedOn !== machine) {
    setReplyBasedOn(machine);
    setReply(null);
  }
  return [reply ?? machine, setReply];
}

/** The trusted certificate of the control in the settings, with the Admin button to forget it */
export function TrustedCertificate({ machine }: { machine: Machine }) {
  const canManage = useCan('manage-machines');
  return canManage ? <TrustedCertificateFields machine={machine} /> : null;
}

function TrustedCertificateFields({ machine }: { machine: Machine }) {
  const [shown, showStatus] = useStatusWithReply(machine);
  const action = useConfirmedAction();
  const thumbprint = shown.type === 'siemens' ? shown.opcuaServerThumbprint : null;

  return (
    <fieldset className="col-span-full m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 text-xs font-semibold text-zinc-300">Trusted certificate of the control</legend>
      {thumbprint ? (
        <>
          <ThumbprintList sha256={thumbprint} sha1={null} />
          <div>
            <ForgetCertificateButton machine={machine} run={action.run} isBusy={action.isBusy} onStatus={showStatus} />
          </div>
        </>
      ) : (
        <p className="m-0 text-xs text-zinc-300">
          Chatter trusts no certificate yet. The next connect trusts the certificate that the control shows.
        </p>
      )}
      <ActionResultNotice result={action.result} onClose={action.clearResult} />
    </fieldset>
  );
}
