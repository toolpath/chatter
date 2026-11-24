import { useCan } from '../../components/CurrentUser';
import { Button } from '../../components/ui/Button';
import { DocsLink } from '../../components/ui/DocsLink';
import { Notice } from '../../components/ui/Notice';
import { fetchMachine, trustOpcuaCertificate } from '../../api/machines';
import type { Machine } from '../../types';
import {
  ActionResultNotice,
  ForgetCertificateButton,
  ThumbprintList,
  TrustCertificateDialog,
  TRUSTED_TEXT,
  useConfirmedAction,
  useStatusWithReply,
} from './opcuaCertificate';

/**
 * The OPC UA notices of a Siemens machine: a changed certificate of the control, and the warning for Security None with
 * a username. Each role sees them, because they are status. Only an Admin gets the buttons to trust or forget (F-11).
 */
export function SiemensNotices({ machine }: { machine: Machine }) {
  const [shown, showStatus] = useStatusWithReply(machine);
  const action = useConfirmedAction();
  if (shown.type !== 'siemens') return null;
  const change = shown.opcuaCertificateChanged;

  return (
    <>
      {change && (
        <Notice tone="error" title="Certificate changed">
          <div className="flex flex-col gap-2.5">
            {change.presentedThumbprint
              ? <ChangedCertificate machine={shown} sha256={change.presentedThumbprint} sha1={change.presentedSha1Thumbprint} action={action} onStatus={showStatus} />
              : <NoCertificate machine={shown} action={action} onStatus={showStatus} />}
          </div>
        </Notice>
      )}
      <ActionResultNotice result={action.result} onClose={action.clearResult} />
      {shown.opcuaSecurityWarning && <Notice tone="info" title="Security warning">{shown.opcuaSecurityWarning}</Notice>}
    </>
  );
}

interface CertificateProps {
  machine: Machine;
  action: ReturnType<typeof useConfirmedAction>;
  onStatus: (status: Machine) => void;
}

/** The control shows a certificate that Chatter does not trust */
function ChangedCertificate({ machine, sha256, sha1, action, onStatus }: CertificateProps & { sha256: string; sha1: string | null }) {
  const canManage = useCan('manage-machines');

  const trust = async () => {
    // After an error the status can be old, for example when the certificate changed again. So load it again.
    const reload = async () => onStatus(await fetchMachine(machine.id).catch(() => machine));
    // Send exactly the thumbprint that the Admin saw
    const status = await action.run(<TrustCertificateDialog sha256={sha256} sha1={sha1} />, () => trustOpcuaCertificate(machine.id, sha256), TRUSTED_TEXT, reload);
    if (status) onStatus(status);
  };

  return (
    <>
      <p className="m-0">
        The control shows a different OPC UA certificate. Chatter does not send the login until an Admin trusts the new
        certificate. A new certificate on the control, or a new control, can be the cause. But a different device at the
        address of the control also shows a different certificate.
      </p>
      <p className="m-0">
        Compare the thumbprints with the certificate on the control: Commissioning &gt; Network &gt; OPC UA &gt; Certificates.
        The control often shows only the SHA-1 thumbprint.{' '}
        <DocsLink page="guide/siemens#check-a-new-certificate">How to check a new certificate</DocsLink>
      </p>
      <ThumbprintList sha256={sha256} sha1={sha1} />
      {canManage && (
        <div>
          <Button size="sm" variant="primary" onClick={trust} disabled={action.isBusy}>Trust new certificate</Button>
        </div>
      )}
    </>
  );
}

/** The control shows no certificate, so there is nothing to trust. An Admin can forget the saved certificate. */
function NoCertificate({ machine, action, onStatus }: CertificateProps) {
  const canManage = useCan('manage-machines');
  return (
    <>
      <p className="m-0">
        The control shows no certificate now, so there is nothing to trust. Chatter does not send the login. Check the OPC UA
        settings of the control. If the control must show no certificate, an Admin can forget the saved certificate.{' '}
        <DocsLink page="guide/siemens#forget-the-trusted-certificate">How to forget the certificate</DocsLink>
      </p>
      {canManage && (
        <div>
          <ForgetCertificateButton machine={machine} run={action.run} isBusy={action.isBusy} onStatus={onStatus} />
        </div>
      )}
    </>
  );
}
