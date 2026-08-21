# The Phishing Race

A guided, interactive demo of why a one-time code loses to a real-time relay, and
what a signed intent changes about that. No install, no wallet app, no signup.

It walks you through three acts one step at a time. Exactly one panel is lit at
any moment — the other two recede — and a coach bar under the stage says one
sentence and points an arrow at whatever you should be looking at. You click,
type and tap your way through; nothing advances on its own.

```bash
npm start
```

Then open http://localhost:4173. Node 18+, zero dependencies.

## Deploying

This is one long-lived Node process. That matters: challenges are minted in
memory and burned on first use, so the same process has to handle both the
issuing and the verifying. Static hosts and serverless platforms cannot run it
as-is — a static host will publish `public/` and silently never execute
`server/`, and split serverless functions each get their own memory, which
breaks the single-use nonce that Act 2 exists to demonstrate.

**Render** — connect the repo; `render.yaml` configures everything. Easiest to
set up, but the free tier suspends the container after ~15 minutes idle and the
next visitor waits 30-50 seconds for it to wake. Fine while iterating, painful
if you are sending the link to someone.

**Cloud Run** — `Dockerfile` is here and needs no arguments:

```bash
gcloud run deploy phishing-race --source . --allow-unauthenticated --region asia-south1
```

Scales to zero like the free tier but wakes in about a second, because the image
is a base image plus 244KB of source with nothing to install. Add
`--min-instances=1` to remove the cold start entirely.

Any host that runs a persistent Node process works: Railway, Fly, a plain VM.
The server reads `PORT` from the environment, binds all interfaces, and needs no
build step and no dependencies.

## The three acts

**Act 1 — SMS OTP.** You land on a lookalike domain, receive a genuine code from
the real bank, and type it in. The attacker relays it into a session of their own
and walks out with full account access. You are never shown an amount, a payee,
or anything else you could have reacted to.

**Act 2 — Stolen signature, replayed.** You sign in for real, on the real origin.
The attacker captures the signature off the wire and replays it. The verifier
returns `401 nonce_already_used`. Challenges are single-use, so the window in
which a captured signature is worth anything is zero.

**Act 3 — Live relay.** The hard case, and the reason this demo has a third act.
The attacker forwards a *genuine* challenge from the *real* bank to your *real*
device. No forgery, no origin trick — the relay works perfectly. It fails on what
your device puts in front of you: an amount and a payee instead of six anonymous
digits.

Act 3 lets you approve without reading, and shows what happens then. It is worth
running that branch: the transfer goes through. Signing does not repair
inattention. What it does is narrow the blast radius from *a session that can do
anything* to *one transfer, for the amount displayed*, with a signature proving
exactly what was authorized.

## What is real

- Real P-256 ECDSA keypair, generated in the browser with WebCrypto.
- The private key is generated **non-extractable** — the page cannot read its own
  signing key. Click the badge in the header and it will try, and show you the
  browser refusing.
- Real single-use nonces with a 90-second expiry, held server-side.
- Real signature verification in Node via `crypto.verify`, over bytes the server
  rebuilds itself rather than trusting anything the client sent.
- `server/otp.js` is an ordinary, correct OTP implementation. Nothing in it was
  weakened to make Act 1 work. It loses because the design loses.

## What is simulated

Custody, and only custody. On a phone the key lives in the Secure Enclave or a
hardware-backed Keystore, and biometrics gate every use. Here it lives in browser
memory for the length of the visit and disappears on reload. The mathematics is
identical; the place the key sleeps is not. The header badge says so on the page,
because anyone evaluating this will open devtools within a minute and we would
rather they find the disclosure than the discrepancy.

## Layout

```
shared/canonical.js   the challenge encoding — imported by BOTH the browser
                      wallet and the Node verifier, so the signed bytes and the
                      verified bytes cannot drift
server/verifier.js    the shared verification service. this is the code a
                      customer would actually write
server/otp.js         a faithful SMS-OTP implementation
server/index.js       static files + the Northwind Bank relying party
public/wallet.js      the browser signer standing in for the wallet app
public/app.js         the three acts
```

`shared/` and `server/verifier.js` are meant to be reused by the other demos in
this repo. Add acts, not verifiers.

## The logos

Four marks, all inline SVG in `public/logos.html` — no image files, no fonts, no
network requests.

- **PTERI** — a shield with a signature stroke through it.
- **Northwind Bank** — a compass needle pointing north, solid north half, faded south.
- **Northwind Bank (the attacker's copy)** — the same compass, deliberately *almost*
  right: a bluer gradient, the needle a hair off centre, a softer corner radius.
  Act 1 and Act 3 render this one; Act 2 renders the genuine mark. Put the two acts
  side by side and the difference is obvious. Look at either alone and it isn't —
  which is the entire business model of phishing.
- **The attacker** — a connection with a break in the middle.

## A note on the fiction

Northwind Bank does not exist. Every name, account number, email and amount here
is invented, and nothing in this repo references a real financial institution.
The lookalike domain in the address bar is drawn in HTML — no such site is
registered, contacted, or resolved.
