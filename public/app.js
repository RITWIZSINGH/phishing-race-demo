// Guided walkthrough. The user drives every step; the app decides where they look.
//
// Two rules hold the whole thing together:
//   1. Exactly one pane is lit at a time. Everything else recedes.
//   2. The coach bar says one thing, and its arrow points at the lit pane.

import { createDevice, signChallenge, tryToStealOwnKey } from '/public/wallet.js';

const RP_ORIGIN = 'https://app.northwind.bank';
const PHISH = 'northwind-secure-verify.co';
const PAYEE = 'Ravi Sharma · A/C ••4471';
const AMOUNT = '₹4,20,000';

const ORDER = ['otp', 'replay', 'relay'];

const RAILS = {
  otp: ['Fake login page', 'Attacker connects', 'Your code arrives', 'You hand it over', 'Code relayed', 'Account emptied'],
  replay: ['Real bank', 'Device signs', 'Signature stolen', 'Replay blocked'],
  relay: ['Fake page again', 'Attacker asks', 'Your phone warns you', 'You decide'],
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ABORT = Symbol('abort');
let runToken = 0;
const alive = (t) => { if (t !== runToken) throw ABORT; };

let enrolled = false;
let lastFocus = null;

// --- primitives -----------------------------------------------------------

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

// --- spotlight ------------------------------------------------------------

const PANES = { victim: 'pane-victim', phone: 'pane-phone', attacker: 'pane-attacker' };

function focusPane(which, tone = '') {
  lastFocus = which;
  for (const [key, id] of Object.entries(PANES)) {
    const pane = $(id);
    pane.classList.toggle('is-focus', key === which);
    pane.classList.toggle('is-danger', key === which && tone === 'danger');
  }
  pointArrow(which);
}

/** Slide the coach-bar arrow under whichever pane is lit. */
function pointArrow(which) {
  const pane = $(PANES[which]);
  if (!pane) return;
  const coach = $('coach');
  const p = pane.getBoundingClientRect();
  const c = coach.getBoundingClientRect();
  $('coach-arrow').style.left = `${p.left + p.width / 2 - c.left}px`;
}

window.addEventListener('resize', () => { if (lastFocus) pointArrow(lastFocus); });

// --- coach bar ------------------------------------------------------------

let step = 0;

function coach(text, eyebrow) {
  $('coach-eyebrow').textContent = eyebrow ?? `Step ${step}`;
  $('coach-text').innerHTML = text;
}

/** Show the Next button and wait for it. This is what makes it self-paced. */
function next(t, label = 'Next →') {
  const cta = $('coach-cta');
  cta.hidden = false;
  cta.className = 'coach__cta';
  cta.textContent = label;
  return new Promise((resolve, reject) => {
    cta.onclick = () => {
      cta.onclick = null;
      cta.hidden = true;
      if (t !== runToken) return reject(ABORT);
      resolve();
    };
  });
}

/** Wait for the user to click something inside a pane. */
function userClick(t, ids, hint = 'Your turn') {
  const list = Array.isArray(ids) ? ids : [ids];
  const cta = $('coach-cta');
  cta.onclick = null;
  cta.hidden = false;
  cta.className = 'coach__cta coach__cta--wait';
  cta.textContent = hint;

  return new Promise((resolve, reject) => {
    for (const id of list) {
      const node = $(id);
      if (!node) continue;
      node.classList.add('cta-pulse');
      node.onclick = () => {
        list.forEach((other) => {
          const el = $(other);
          if (el) { el.classList.remove('cta-pulse'); el.onclick = null; }
        });
        cta.hidden = true;
        if (t !== runToken) return reject(ABORT);
        resolve(id);
      };
    }
  });
}

function railFor(act) {
  const rail = $('rail');
  rail.innerHTML = RAILS[act]
    .map((label, i) => `<li data-i="${i}"><span>0${i + 1}</span><b>${label}</b></li>`)
    .join('');
}

function markRail(i) {
  step = i + 1;
  document.querySelectorAll('#rail li').forEach((li, n) => {
    li.dataset.state = n === i ? 'current' : n < i ? 'done' : '';
  });
}

/** Advance the rail, light a pane, and say one thing. */
function scene(i, { on, tone, text, eyebrow }) {
  markRail(i);
  focusPane(on, tone);
  coach(text, eyebrow);
}

// --- panes ----------------------------------------------------------------

function setUrl(text, kind) {
  $('url-text').textContent = text;
  $('url-bar').className = 'chrome__url' + (kind ? ` chrome__url--${kind}` : '');
}

const setVictim = (html) => { $('victim').innerHTML = html; };
const setPhone = (html) => { $('phone').innerHTML = html; };
const idlePhone = (text) => setPhone(`<div class="phone__idle"><div>${text}</div></div>`);
const setBytes = (text) => { $('bytes').textContent = text; };
const clearTerminal = () => { $('terminal').innerHTML = ''; };

function line(html, cls = '') {
  const node = document.createElement('div');
  node.className = `t-line ${cls}`;
  node.innerHTML = html;
  $('terminal').append(node);
}

function jsonLine(obj) {
  const pre = document.createElement('pre');
  pre.className = 't-json';
  pre.textContent = JSON.stringify(obj, null, 2);
  $('terminal').append(pre);
}

/** Terminal lines land one at a time so the eye can follow them. */
async function typeLines(t, entries, gap = 420) {
  for (const entry of entries) {
    if (typeof entry === 'string') line(entry);
    else if (entry.json) jsonLine(entry.json);
    else line(entry.text, entry.cls);
    await sleep(gap); alive(t);
  }
}

const bankHeader = (fake = false) => `
  <div class="bank__logo">
    <svg aria-hidden="true"><use href="#logo-northwind${fake ? '-fake' : ''}"/></svg>
    <b>Northwind Bank</b>
  </div>`;

async function ensureDevice() {
  if (enrolled) return;
  const publicKey = await createDevice();
  await post('/api/pteri/enroll', { publicKey });
  enrolled = true;
}

function walletSheet({ origin, action, detail, mismatch, buttons }) {
  return `
    <div class="sheet">
      <div class="sheet__title">
        <svg class="sheet__mark" aria-hidden="true"><use href="#logo-wallet"/></svg>
        PTERI Wallet · approval
      </div>
      <div class="sheet__origin">${origin}</div>
      <div class="sheet__action">${action}</div>
      <div class="sheet__detail">${detail}</div>
      ${mismatch ? `<div class="sheet__mismatch">${mismatch}</div>` : ''}
      <div class="sheet__bio"><i>☝︎</i>Face ID unlocks the key</div>
      ${buttons}
    </div>`;
}

function settled(title, detail, tone = 'ok') {
  setPhone(`
    <div class="sheet">
      <div class="sheet__title">
        <svg class="sheet__mark" aria-hidden="true"><use href="#logo-wallet"/></svg>
        PTERI Wallet
      </div>
      <div class="sheet__action" style="color:var(--${tone})">${title}</div>
      <div class="sheet__detail">${detail}</div>
    </div>`);
}

function result(kind, head, chips, buttons = '') {
  const node = $('result');
  node.hidden = false;
  node.className = `result result--${kind}`;
  node.innerHTML = `
    <div class="result__head">${head}</div>
    <div class="chips">
      ${chips.map((c) => `<div class="chip"><span>${c.k}</span><b>${c.v}</b></div>`).join('')}
      ${buttons}
    </div>`;
}

const hideResult = () => { $('result').hidden = true; };

const nextActButton = (act) =>
  `<button class="result__go" data-go="${act}">Next: ${act === 'replay' ? 'what a signature changes' : 'the hard case'} →</button>`;

// --- Act 1 ----------------------------------------------------------------

async function actOtp(t) {
  const FAKE = true;              // lookalike domain, lookalike logo
  setUrl(PHISH, 'phish');
  idlePhone('Quiet for now.');
  clearTerminal();
  line('waiting for a visitor…', 't-dim');

  setVictim(`${bankHeader(FAKE)}
    <div class="bank">
      <h2>Sign in</h2>
      <p>Verify your identity to continue.</p>
      <div class="field"><label>Registered email</label><input value="priya@example.com" readonly></div>
      <button class="btn" id="continue">Continue</button>
    </div>`);

  scene(0, {
    on: 'victim',
    text: `This login page looks perfect — but the address is <span class="bad">${PHISH}</span>, not the bank. <b>Click Continue.</b>`,
  });
  await userClick(t, 'continue', 'Click Continue');

  const otp = await post('/api/otp/request', { username: 'priya@example.com' });
  alive(t);

  scene(1, {
    on: 'attacker', tone: 'danger',
    text: `The moment you clicked, the attacker opened a <b>real</b> login at the bank — using your email.`,
  });
  clearTerminal();
  await typeLines(t, [
    { text: 'victim → priya@example.com', cls: 't-hit' },
    { text: `opening a real session at ${RP_ORIGIN}`, cls: 't-dim' },
    { text: 'POST /api/otp/request', cls: '' },
  ]);
  await next(t);

  setPhone(`<div class="sms">
      <div class="sms__from">SMS · NORTHWIND</div>
      <div class="sms__bubble">Your verification code is
        <span class="sms__code">${otp.deliveredCode}</span>
        Never share this code with anyone.</div>
    </div>`);

  scene(2, {
    on: 'phone',
    text: `Your phone buzzes. This code is <b>completely genuine</b> — the real bank really did send it.`,
  });
  await next(t);

  setVictim(`${bankHeader(FAKE)}
    <div class="bank">
      <h2>Enter your code</h2>
      <p>We sent a 6-digit code to your mobile.</p>
      <div class="field"><label>Verification code</label>
        <input id="otp-input" class="code" maxlength="6" inputmode="numeric" placeholder="······"></div>
      <button class="btn" id="otp-submit" disabled>Verify and continue</button>
    </div>`);

  scene(3, {
    on: 'victim',
    text: `Now <b>type the code</b> from your phone into the page. This is the only thing the attack needs you to do.`,
  });

  const input = $('otp-input');
  const submit = $('otp-submit');
  input.focus();
  input.addEventListener('input', () => {
    submit.disabled = input.value.trim().length !== 6;
    submit.classList.toggle('cta-pulse', !submit.disabled);
  });

  await userClick(t, 'otp-submit', 'Type the 6 digits');

  const typed = input.value.trim();
  const res = await post('/api/otp/verify', { loginSessionId: otp.loginSessionId, code: typed });
  alive(t);

  scene(4, { on: 'attacker', tone: 'danger', text: `Watch the attacker. Your code went straight into <b>their</b> session.` });
  await typeLines(t, [
    { text: `captured: ${typed}`, cls: 't-hit' },
    { text: 'POST /api/otp/verify', cls: '' },
    { json: { ok: res.ok, scope: res.scope ?? 'wrong_code' } },
  ]);

  if (!res.ok) {
    coach(`That wasn't the code on the phone, so the relay stalled. <b>Restart</b> and use the real one — the point is that the real code works fine for them.`);
    focusPane('attacker');
    await next(t, 'Restart act');
    return run('otp');
  }

  await typeLines(t, [{ text: 'signed in as priya@example.com', cls: 't-hit' }]);
  await next(t);

  scene(5, { on: 'attacker', tone: 'danger', text: `Full account access. They move <span class="bad">${AMOUNT}</span> while you stare at a spinner.` });
  await typeLines(t, [
    { text: `transfer ${AMOUNT} → ${PAYEE}`, cls: 't-hit' },
    { text: 'done.', cls: 't-hit' },
  ]);

  setVictim(`${bankHeader(FAKE)}
    <div class="bank"><h2>Verifying…</h2>
    <p>This is taking longer than usual. Please don't close this window.</p></div>`);
  idlePhone('You were never asked to approve anything.<br>Only to <i>read</i> something.');

  result('bad', 'Account compromised', [
    { k: 'Attacker got', v: 'Full account' },
    { k: 'You were shown', v: '6 digits' },
    { k: 'Chance to spot it', v: 'None' },
  ], nextActButton('replay'));

  coach(`Nothing on your screen could have told you this was a transfer. There was no amount, no payee — just six digits.`, 'Act 1 complete');
}

// --- Act 2 ----------------------------------------------------------------

async function actReplay(t) {
  const FAKE = false;             // the genuine bank, genuine mark
  await ensureDevice(); alive(t);
  setUrl(RP_ORIGIN.replace('https://', ''), 'real');
  idlePhone('Wallet ready.');
  clearTerminal();
  line('passive tap. reading traffic.', 't-dim');

  setVictim(`${bankHeader(FAKE)}
    <div class="bank">
      <h2>Sign in</h2>
      <p>No password. Your device approves.</p>
      <button class="btn" id="signin">Sign in with PTERI</button>
    </div>`);

  scene(0, {
    on: 'victim',
    text: `Same you — but this is the <span class="good">real</span> bank. The attacker can only watch the wire. <b>Sign in.</b>`,
  });
  await userClick(t, 'signin', 'Click Sign in');

  const ch = await post('/api/pteri/challenge', { action: 'Sign in', detail: 'Northwind Bank · web session' });
  alive(t);
  setBytes(ch.message);

  setPhone(walletSheet({
    origin: ch.origin, action: ch.action, detail: ch.detail,
    buttons: `<button class="pbtn pbtn--go" id="approve">Approve</button>`,
  }));

  scene(1, {
    on: 'phone',
    text: `Your device receives a <b>single-use challenge</b> and shows you what it's for. <b>Tap Approve.</b>`,
  });
  await userClick(t, 'approve', 'Tap Approve');

  const { signature, message } = await signChallenge(ch);
  alive(t);
  setBytes(message);
  settled('Approved', 'Signed once. The key never left the device.');

  await post('/api/pteri/verify', { nonce: ch.nonce, signature });
  alive(t);

  setVictim(`${bankHeader(FAKE)}
    <div class="account">
      <h2 style="margin:0 0 10px;font-size:19px">Welcome back, Priya</h2>
      <div class="account__row"><span>Balance</span><b>₹8,64,210</b></div>
      <div class="account__row"><span>Session</span><b>this device</b></div>
    </div>`);

  scene(2, { on: 'attacker', tone: 'danger', text: `The attacker copies your signature straight off the network. They now hold a <b>valid</b> one.` });
  await typeLines(t, [
    { text: 'signature captured off the wire', cls: 't-hit' },
    { json: { signature: signature.slice(0, 30) + '…', bytes: 64 } },
  ]);
  await next(t, 'Now let them replay it →');

  const replayed = await post('/api/pteri/verify', { nonce: ch.nonce, signature });
  alive(t);

  scene(3, { on: 'attacker', text: `They send it back to the bank — and it <span class="good">bounces</span>. A signature is spent the instant it's used.` });
  await typeLines(t, [
    { text: 'POST /api/pteri/verify — replayed', cls: 't-hit' },
    { json: { ok: false, code: replayed.code } },
    { text: '401. inert.', cls: 't-good' },
  ]);

  result('good', 'A stolen signature is worthless', [
    { k: 'Valid for', v: 'One use' },
    { k: 'Replay window', v: '0 seconds' },
    { k: 'An OTP', v: '5 min, anyone' },
  ], nextActButton('relay'));

  coach(`This beats an attacker who <i>records</i> you. The next act is the one that actually matters — an attacker who relays you <b>live</b>.`, 'Act 2 complete');
}

// --- Act 3 ----------------------------------------------------------------

async function actRelay(t) {
  const FAKE = true;              // lookalike again
  await ensureDevice(); alive(t);
  setUrl(PHISH, 'phish');
  idlePhone('Wallet ready.');
  clearTerminal();
  line('visitor on the lookalike domain.', 't-dim');

  setVictim(`${bankHeader(FAKE)}
    <div class="bank">
      <h2>Sign in</h2>
      <p>No password. Your device approves.</p>
      <button class="btn" id="signin">Sign in with PTERI</button>
    </div>`);

  scene(0, {
    on: 'victim',
    text: `You're back on the fake page — and this time the attacker gets clever. <b>Sign in.</b>`,
  });
  await userClick(t, 'signin', 'Click Sign in');

  const ch = await post('/api/pteri/challenge', { action: 'Approve transfer', detail: `${AMOUNT} to ${PAYEE}` });
  alive(t);
  setBytes(ch.message);

  scene(1, {
    on: 'attacker', tone: 'danger',
    text: `They ask the real bank for a challenge — but for a <span class="bad">transfer</span>, not a login. Then they forward it to you.`,
  });
  await typeLines(t, [
    { text: `opening a real session at ${RP_ORIGIN}`, cls: 't-dim' },
    { text: 'requesting a challenge — not for a login', cls: 't-hit' },
    { json: { action: ch.action, detail: ch.detail } },
    { text: 'relaying it to the victim device', cls: 't-hit' },
  ]);
  await next(t);

  setPhone(walletSheet({
    origin: ch.origin, action: ch.action, detail: ch.detail,
    mismatch: '⚠︎ You tapped <b>Sign in</b>. This is a payment.',
    buttons: `
      <button class="pbtn pbtn--no" id="decline">Decline</button>
      <button class="pbtn pbtn--risk" id="approve">Approve anyway</button>`,
  }));

  setVictim(`${bankHeader(FAKE)}
    <div class="bank"><h2>Check your phone</h2><p>Approval sent to your PTERI Wallet.</p></div>`);

  scene(2, {
    on: 'phone',
    text: `Nothing was forged — that challenge is genuine, from the real bank. But your phone shows what it <b>actually authorises</b>: ${AMOUNT} to a stranger.`,
  });
  await next(t);

  scene(3, { on: 'phone', text: `You asked to log in. You're being asked to pay. <b>Your call.</b>` });
  const choice = await userClick(t, ['decline', 'approve'], 'Decline or approve');

  if (choice === 'decline') {
    settled('Declined', 'Nothing signed. The challenge expires unused.');
    focusPane('attacker');
    coach(`The relay was technically perfect. It failed because your device could <span class="good">show you the truth</span> — and an OTP has no truth to show.`, 'Act 3 complete');
    await typeLines(t, [
      { text: 'victim declined.', cls: 't-good' },
      { text: 'no signature. no session. no transfer.', cls: 't-good' },
    ]);

    setVictim(`${bankHeader(FAKE)}
      <div class="bank"><h2>Request declined</h2><p>Nothing was approved. No money moved.</p></div>`);

    result('good', 'The relay worked. It still lost.', [
      { k: 'An OTP shows you', v: '6 digits' },
      { k: 'PTERI shows you', v: 'Amount + payee' },
      { k: 'Attacker got', v: 'Nothing' },
    ], `<button class="result__alt" id="alt">But what if you tap Approve without reading?</button>`);
    return;
  }

  const { signature, message } = await signChallenge(ch);
  alive(t);
  setBytes(message);
  settled('Approved', `You signed: ${AMOUNT} to Ravi Sharma.`, 'warn');

  await post('/api/pteri/verify', { nonce: ch.nonce, signature });
  alive(t);

  focusPane('attacker', 'danger');
  coach(`Money moved — signing can't fix not looking. But watch what they <b>didn't</b> get.`, 'The honest version');
  await typeLines(t, [
    { text: `transfer authorized: ${AMOUNT}`, cls: 't-hit' },
    { text: 'no session token returned.', cls: 't-dim' },
    { text: 'cannot browse, add payees, or change the passphrase.', cls: 't-dim' },
  ]);

  setVictim(`${bankHeader(FAKE)}
    <div class="account">
      <h2 style="margin:0 0 10px;font-size:19px">Transfer sent</h2>
      <div class="account__row"><span>Amount</span><b>${AMOUNT}</b></div>
      <div class="account__row"><span>To</span><b>Ravi Sharma</b></div>
      <div class="account__row"><span>Signed by</span><b>your device</b></div>
    </div>`);

  result('mixed', 'One transfer — not the whole account', [
    { k: 'Act 1 attacker got', v: 'Full account' },
    { k: 'Here they got', v: 'One transfer' },
    { k: 'And you have', v: 'A signed record' },
  ], `<button class="result__alt" id="alt">Replay, and read it this time</button>`);
}

// --- runner ---------------------------------------------------------------

const ACTS = { otp: actOtp, replay: actReplay, relay: actRelay };
let current = 'otp';

async function run(act) {
  const t = ++runToken;
  current = act;
  hideResult();
  railFor(act);
  $('coach-cta').onclick = null;
  $('coach-cta').hidden = true;

  document.querySelectorAll('.step').forEach((el, n) => {
    const i = ORDER.indexOf(act);
    el.dataset.state = n === i ? 'playing' : n < i ? 'done' : '';
  });

  try {
    await ACTS[act](t);
  } catch (err) {
    if (err !== ABORT) throw err;
  }
}

$('track').addEventListener('click', (e) => {
  const el = e.target.closest('.step');
  if (el) run(el.dataset.act);
});

$('restart').addEventListener('click', () => run(current));

$('result').addEventListener('click', (e) => {
  if (e.target.dataset.go) run(e.target.dataset.go);
  if (e.target.id === 'alt') run('relay');
});

$('details-toggle').addEventListener('click', () => {
  const box = $('details');
  box.hidden = !box.hidden;
  $('details-toggle').textContent = box.hidden ? 'Technical details' : 'Hide details';
});

$('probe').addEventListener('click', async () => {
  await ensureDevice();
  const probe = await tryToStealOwnKey();
  const out = $('probe-out');
  out.hidden = false;
  out.textContent = probe.escaped ? 'Unexpected: key was exportable.' : `refused → ${probe.error}`;
});

run('otp');
