import { createHash } from 'node:crypto';

/**
 * Trust on first use (TOFU) of the OPC UA certificate of a Siemens control (F-11).
 * Chatter saves the thumbprint of the certificate of the first connect. Later, it sends the login only to a control
 * that shows the same certificate. A different certificate needs an Admin: see SiemensConnector.trustCertificate.
 */

/** The first DER element of the bytes: the certificate of the control, when the bytes are a chain */
function firstCertificate(der: Buffer): Buffer {
  const DER_SEQUENCE = 0x30;
  if (der.length < 2 || der[0] !== DER_SEQUENCE) return der;
  const lengthByte = der[1];
  if (lengthByte < 0x80) return der.subarray(0, 2 + lengthByte);
  const lengthBytes = lengthByte & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 4 || der.length < 2 + lengthBytes) return der;
  const length = der.subarray(2, 2 + lengthBytes).reduce((total, byte) => total * 256 + byte, 0);
  const end = 2 + lengthBytes + length;
  return end <= der.length ? der.subarray(0, end) : der;
}

/**
 * The thumbprint of a certificate: the SHA-256 of its DER bytes, as 64 lowercase hex digits.
 * The same value as `openssl x509 -fingerprint -sha256`, with no colons. Of a chain, only the first certificate counts.
 * OPC UA itself names certificates by SHA-1, but SHA-256 is the safer hash for a check of identity.
 */
export function certificateThumbprint(der: Buffer): string {
  return createHash('sha256').update(firstCertificate(der)).digest('hex');
}

/**
 * The SHA-1 thumbprint of a certificate, as 40 lowercase hex digits: `openssl x509 -fingerprint -sha1` with no colons.
 * A control can show only this one on its screen. Chatter gives it only for that comparison, and never trusts by it.
 */
export function certificateSha1Thumbprint(der: Buffer): string {
  return createHash('sha1').update(firstCertificate(der)).digest('hex');
}

export type PinCheck =
  /** The certificate is the trusted one */
  | { outcome: 'trusted' }
  /** No certificate is trusted yet: trust this one and save it */
  | { outcome: 'firstUse'; thumbprint: string }
  /** No certificate is trusted, and the control shows none (possible only with no security): nothing to save */
  | { outcome: 'noCertificate' }
  /** A different certificate, or none in place of the trusted one: send no login */
  | { outcome: 'changed'; presented: string | null };

/** Compare the certificate that the control shows with the trusted one */
export function checkPin(trusted: string | null, presented: string | null): PinCheck {
  if (trusted === null) return presented === null ? { outcome: 'noCertificate' } : { outcome: 'firstUse', thumbprint: presented };
  return presented === trusted ? { outcome: 'trusted' } : { outcome: 'changed', presented };
}

/** The control showed a certificate that is not the trusted one. Chatter did not send the login. */
export class CertificateChangedError extends Error {
  constructor(
    readonly presentedThumbprint: string | null,
    readonly trustedThumbprint: string,
    /** The SHA-1 thumbprint of the certificate that the control shows, to compare with its screen */
    readonly presentedSha1Thumbprint: string | null = null,
  ) {
    const shown = presentedThumbprint === null ? 'The control shows no certificate now' : `The control shows ${presentedThumbprint}`;
    super(`The OPC UA certificate of the control changed. Chatter did not send the login. ${shown}, `
      + `but Chatter trusts ${trustedThumbprint}. Check the control. If the control has a new certificate, an Admin must trust it.`);
    this.name = 'CertificateChangedError';
  }
}
