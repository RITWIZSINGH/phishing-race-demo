// The canonical challenge encoding.
//
// This exact file is imported by BOTH the browser wallet (public/wallet.js) and
// the Node verifier (server/verifier.js). That is deliberate: the bytes the
// device signs and the bytes the server verifies are produced by one function,
// so they cannot drift apart.
//
// The format is line-oriented and human-readable on purpose. A signing prompt
// should be something a person can be shown verbatim.

export const PROTOCOL = 'PTERI-AUTH-v1';

/**
 * Deterministically serialize a challenge record into the exact bytes to sign.
 * Field order is fixed. Never reorder, never add fields without bumping PROTOCOL.
 */
export function serializeChallenge(c) {
  return [
    PROTOCOL,
    `nonce=${c.nonce}`,
    `origin=${c.origin}`,
    `action=${c.action}`,
    `detail=${c.detail}`,
    `iat=${c.iat}`,
    `exp=${c.exp}`,
  ].join('\n');
}
