// The shared verification service.
//
// Every demo in this repo goes through this module, and it is the code a
// customer would actually write. Keep it small enough to read in one sitting.

import crypto from 'node:crypto';
import { serializeChallenge } from '../public/shared/canonical.js';

const CHALLENGE_TTL_MS = 90_000;

/** nonce -> challenge record */
const challenges = new Map();
/** userId -> SPKI public key (base64) */
const enrolledKeys = new Map();

const FAILURES = {
  unknown_nonce: 'No challenge was ever issued with this nonce.',
  nonce_already_used:
    'This challenge was already spent. Challenges are single-use, so a captured signature is worthless the moment it lands.',
  challenge_expired: 'The challenge passed its expiry window before the signature arrived.',
  origin_mismatch: 'The signature commits to a different relying party than the one verifying it.',
  no_enrolled_key: 'No device key is enrolled for this user.',
  bad_signature: 'The signature does not verify against the enrolled public key over these exact bytes.',
};

function fail(code, extra = {}) {
  return { ok: false, code, reason: FAILURES[code] ?? code, ...extra };
}

export function enrollDevice(userId, publicKeySpkiB64) {
  enrolledKeys.set(userId, publicKeySpkiB64);
  return { ok: true, userId, publicKey: publicKeySpkiB64 };
}

export function getEnrolledKey(userId) {
  return enrolledKeys.get(userId) ?? null;
}

/**
 * Mint a single-use challenge bound to a relying party, an action and the
 * human-readable detail of that action.
 */
export function issueChallenge({ origin, action, detail }) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const iat = Date.now();
  const record = {
    nonce,
    origin,
    action,
    detail,
    iat,
    exp: iat + CHALLENGE_TTL_MS,
  };
  challenges.set(nonce, record);
  // The client needs the record to reconstruct the bytes, plus the rendered
  // string so the UI can show exactly what is about to be signed.
  return { ...record, message: serializeChallenge(record) };
}

/**
 * Verify a signature over a previously issued challenge.
 *
 * The message is rebuilt from the SERVER's stored record, never from anything
 * the caller supplied. A client that sends its own payload string can lie about
 * what it signed; a server that recomputes cannot be lied to.
 */
export function verifySignature({ userId, nonce, signatureB64, expectedOrigin }) {
  const record = challenges.get(nonce);
  if (!record) return fail('unknown_nonce');
  if (record.used) return fail('nonce_already_used', { spentAt: record.usedAt });
  if (Date.now() > record.exp) return fail('challenge_expired');
  if (expectedOrigin && record.origin !== expectedOrigin) {
    return fail('origin_mismatch', { signedOrigin: record.origin, expectedOrigin });
  }

  const publicKeySpkiB64 = enrolledKeys.get(userId);
  if (!publicKeySpkiB64) return fail('no_enrolled_key');

  const message = Buffer.from(serializeChallenge(record), 'utf8');

  let verified = false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeySpkiB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    // WebCrypto emits raw r||s, which Node calls ieee-p1363.
    verified = crypto.verify(
      'sha256',
      message,
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    verified = false;
  }

  if (!verified) return fail('bad_signature');

  record.used = true;
  record.usedAt = Date.now();

  return {
    ok: true,
    record,
    message: message.toString('utf8'),
    authorized: { action: record.action, detail: record.detail, origin: record.origin },
  };
}

export function resetVerifier() {
  challenges.clear();
  enrolledKeys.clear();
}
