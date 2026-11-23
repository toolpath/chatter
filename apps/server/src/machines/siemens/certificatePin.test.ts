import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { certificateThumbprint, checkPin, CertificateChangedError } from './certificatePin.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A DER SEQUENCE with the given content, as a certificate starts */
function derSequence(content: Buffer): Buffer {
  const length = content.length;
  if (length < 0x80) return Buffer.concat([Buffer.from([0x30, length]), content]);
  return Buffer.concat([Buffer.from([0x30, 0x82, length >> 8, length & 0xff]), content]);
}

const PINNED = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('certificateThumbprint', () => {
  it('is the SHA-256 of the DER bytes, as 64 lowercase hex digits', () => {
    const certificate = derSequence(Buffer.from('certificate of the control'));
    expect(certificateThumbprint(certificate)).toBe(sha256(certificate));
    expect(certificateThumbprint(certificate)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses only the first certificate of a chain, the certificate of the control', () => {
    const leaf = derSequence(Buffer.alloc(300, 1));
    const issuer = derSequence(Buffer.from('issuer'));
    expect(certificateThumbprint(Buffer.concat([leaf, issuer]))).toBe(sha256(leaf));
  });

  it('uses all the bytes when they do not start with a certificate of a length that fits', () => {
    const strange = Buffer.from([0x30, 0x82, 0xff, 0xff, 1, 2, 3]);
    expect(certificateThumbprint(strange)).toBe(sha256(strange));
  });
});

describe('checkPin', () => {
  it('saves the certificate on the first connect, when no certificate is trusted yet', () => {
    expect(checkPin(null, OTHER)).toEqual({ outcome: 'firstUse', thumbprint: OTHER });
  });

  it('accepts the trusted certificate', () => {
    expect(checkPin(PINNED, PINNED)).toEqual({ outcome: 'trusted' });
  });

  it('refuses a different certificate', () => {
    expect(checkPin(PINNED, OTHER)).toEqual({ outcome: 'changed', presented: OTHER });
  });

  it('refuses a control that shows no certificate when a certificate is trusted', () => {
    expect(checkPin(PINNED, null)).toEqual({ outcome: 'changed', presented: null });
  });

  it('has nothing to save when the control shows no certificate and none is trusted', () => {
    expect(checkPin(null, null)).toEqual({ outcome: 'noCertificate' });
  });
});

describe('CertificateChangedError', () => {
  it('tells the user that Chatter did not log in, and gives the two thumbprints', () => {
    const error = new CertificateChangedError(OTHER, PINNED);
    expect(error.presentedThumbprint).toBe(OTHER);
    expect(error.trustedThumbprint).toBe(PINNED);
    expect(error.message).toContain('certificate of the control changed');
    expect(error.message).toContain('did not send the login');
    expect(error.message).toContain(OTHER);
  });

  it('tells when the control shows no certificate', () => {
    expect(new CertificateChangedError(null, PINNED).message).toContain('shows no certificate');
  });
});
