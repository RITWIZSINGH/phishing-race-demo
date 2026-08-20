// The browser wallet — a real signer, standing in for the PTERI Wallet app.
//
// What is real here: a P-256 keypair, ECDSA over SHA-256, and a signature that
// a completely independent verifier checks with node:crypto. The private key is
// generated non-extractable, so this page cannot read its own signing key even
// if it wanted to.
//
// What is simulated: custody. On a phone the key lives in the Secure Enclave or
// a hardware-backed Keystore and biometrics gate every use. Here it lives in
// browser memory for the length of the page visit. The maths is identical; the
// place the key sleeps is not.

import { serializeChallenge } from '/shared/canonical.js';

let keyPair = null;
let publicKeyB64 = null;

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Create the device key. `extractable: false` applies to the private key;
 * per the WebCrypto spec the public half stays exportable, which is exactly
 * the asymmetry we want.
 */
export async function createDevice() {
  keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  publicKeyB64 = toBase64(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  return publicKeyB64;
}

export function getPublicKey() {
  return publicKeyB64;
}

/**
 * Sign a challenge record. The bytes come from the shared canonical serializer,
 * not from anything the caller handed us pre-rendered.
 */
export async function signChallenge(record) {
  if (!keyPair) throw new Error('device not enrolled');
  const message = serializeChallenge(record);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(message),
  );
  return { signature: toBase64(signature), message };
}

/** Prove the claim in the header badge: the page really cannot read the key. */
export async function tryToStealOwnKey() {
  try {
    await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    return { escaped: true, error: null };
  } catch (err) {
    return { escaped: false, error: String(err?.message ?? err) };
  }
}

export function forgetDevice() {
  keyPair = null;
  publicKeyB64 = null;
}
