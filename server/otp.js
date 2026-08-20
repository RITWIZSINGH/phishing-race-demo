// A faithful SMS-OTP implementation.
//
// Nothing here is sabotaged to make the demo work. This is how OTP is specified
// and how essentially every deployment behaves: a short numeric code, a few
// minutes of validity, and verification that checks the CODE and nothing else.
//
// The vulnerability is not a bug in this file. It is the design: the code is a
// bearer credential. Whoever presents it wins, and the login session it unlocks
// belongs to whoever asked for the code, not to whoever received it.

import crypto from 'node:crypto';

const OTP_TTL_MS = 300_000;

/** loginSessionId -> { username, code, exp, verified } */
const loginSessions = new Map();

function sixDigits() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Start a login and dispatch a code. Note what the caller gets back: a session
 * id tied to THEM. The code goes to the account holder's phone. Those are two
 * different parties whenever this is called by an attacker.
 */
export function requestOtp(username) {
  const loginSessionId = crypto.randomBytes(12).toString('base64url');
  const code = sixDigits();
  loginSessions.set(loginSessionId, {
    username,
    code,
    exp: Date.now() + OTP_TTL_MS,
    verified: false,
  });
  return {
    loginSessionId,
    // Delivered out-of-band over SMS in the real world; surfaced here so the
    // phone pane can render the message.
    deliveredCode: code,
    deliveredTo: username,
  };
}

export function verifyOtp(loginSessionId, code) {
  const session = loginSessions.get(loginSessionId);
  if (!session) return { ok: false, code: 'unknown_session' };
  if (Date.now() > session.exp) return { ok: false, code: 'otp_expired' };
  if (String(code).trim() !== session.code) return { ok: false, code: 'wrong_code' };

  session.verified = true;
  // A full, unscoped session token. The code proved possession of a phone at
  // some moment. It said nothing about what the holder intended to do.
  return {
    ok: true,
    sessionToken: crypto.randomBytes(24).toString('base64url'),
    username: session.username,
    scope: 'full_account_access',
  };
}

export function resetOtp() {
  loginSessions.clear();
}
