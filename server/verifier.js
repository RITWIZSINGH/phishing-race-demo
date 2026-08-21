// The shared verification service.
//
// Every demo in this repo goes through this module, and it is the code a
// customer would actually write. Keep it small enough to read in one sitting.

import crypto from 'node:crypto';
import { serializeChallenge } from '../public/shared/canonical.js';

const CHALLENGE_TTL_MS = 90_000;
const DEVICE_TTL_MS = 30 * 60_000;

/** nonce -> challenge record */
const challenges = new Map();
/** demo session id -> { publicKey, seen } */
const enrolledKeys = new Map();

// Every visitor gets their own device key. Keying this by a fixed user id meant
// the second visitor's enrolment overwrote the first's, and the first then
// failed verification for the rest of their visit. Harmless with one person on
// localhost; constant once the demo is on a public page.
//
// Nothing here is durable, and it does not need to be: a challenge is dead 90
// seconds after it is minted and a visitor is gone long before the half hour.
// Without this sweep the maps only ever grow, which is fine for a demo server
// that restarts often and is a slow leak inside a long-lived process.
function sweep() {
  const now = Date.now();
  for (const [nonce, rec] of challenges) {
    if (now > rec.exp + CHALLENGE_TTL_MS) challenges.delete(nonce);
  }
  for (const [sid, rec] of enrolledKeys) {
    if (now - rec.seen > DEVICE_TTL_MS) enrolledKeys.delete(sid);
  }
}
setInterval(sweep, 60_000).unref();

const FAILURES = {
  unknown_nonce: 'No challenge was ever issued with this nonce.',
  nonce_already_used:
    'This challenge was already spent. Challenges are single-use, so a captured signature is worthless the moment it lands.',
  challenge_expired: 'The challenge passed its expiry window before the signature arrived.',
  origin_mismatch: 'The signature commits to a different relying party than the one verifying it.',
  no_enrolled_key: 'No device key is enrolled for this visitor.',
  wrong_session: 'This challenge belongs to a different visitor.',
  bad_signature: 'The signature does not verify against the enrolled public key over these exact bytes.',
};

function fail(code, extra = {}) {
  return { ok: false, code, reason: FAILURES[code] ?? code, ...extra };
}

export function enrollDevice(sid, publicKeySpkiB64) {
  enrolledKeys.set(sid, { publicKey: publicKeySpkiB64, seen: Date.now() });
  return { ok: true, publicKey: publicKeySpkiB64 };
}

export function getEnrolledKey(sid) {
  return enrolledKeys.get(sid)?.publicKey ?? null;
}

/**
 * Mint a single-use challenge bound to a relying party, an action and the
 * human-readable detail of that action.
 */
export function issueChallenge({ sid, origin, action, detail }) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const iat = Date.now();
  const record = {
    nonce,
    sid,
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
export function verifySignature({ sid, nonce, signatureB64, expectedOrigin }) {
  const record = challenges.get(nonce);
  if (!record) return fail('unknown_nonce');
  if (record.sid !== sid) return fail('wrong_session');
  if (record.used) return fail('nonce_already_used', { spentAt: record.usedAt });
  if (Date.now() > record.exp) return fail('challenge_expired');
  if (expectedOrigin && record.origin !== expectedOrigin) {
    return fail('origin_mismatch', { signedOrigin: record.origin, expectedOrigin });
  }

  const enrolled = enrolledKeys.get(sid);
  if (!enrolled) return fail('no_enrolled_key');
  enrolled.seen = Date.now();
  const publicKeySpkiB64 = enrolled.publicKey;

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

/** Clear one visitor's state. Never everyone's — other people are mid-demo. */
export function resetVerifier(sid) {
  for (const [nonce, rec] of challenges) {
    if (rec.sid === sid) challenges.delete(nonce);
  }
  enrolledKeys.delete(sid);
}
