// Zero-dependency demo server: static files + the Northwind Bank relying party.
//
// Northwind Bank is fictional. Every name, account and rupee in this repo is
// invented.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestOtp, verifyOtp, resetOtp } from './otp.js';
import {
  enrollDevice,
  issueChallenge,
  verifySignature,
  resetVerifier,
} from './verifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ?? 4173;

const RP_ORIGIN = 'https://app.northwind.bank';
const PHISH_ORIGIN = 'https://northwind-secure-verify.co';
const DEMO_USER = 'priya@example.com';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

// --- static ---------------------------------------------------------------

// `public/` is the web root, exactly as it is once deployed. Keeping dev and
// prod on the same URL layout is the whole reason this function is so fussy:
// serving the repo root locally is what let /public/styles.css work here and
// 404 in production.
const WEB_ROOT = path.join(ROOT, 'public');

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = path.join(WEB_ROOT, rel);

  // Never escape the web root, whatever the request path claims.
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) {
    return json(res, 404, { error: 'not_found' });
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not_found', pathname });
  }
}

// --- routes ---------------------------------------------------------------

const routes = {
  // Act 1: the OTP relay.
  'POST /api/otp/request': async (body) => {
    const result = requestOtp(body.username ?? DEMO_USER);
    return [200, result];
  },

  'POST /api/otp/verify': async (body) => {
    const result = verifyOtp(body.loginSessionId, body.code);
    return [result.ok ? 200 : 401, result];
  },

  // Enrol the browser wallet's public key.
  'POST /api/pteri/enroll': async (body) => {
    if (!body.publicKey) return [400, { ok: false, code: 'missing_public_key' }];
    return [200, enrollDevice(body.userId ?? DEMO_USER, body.publicKey)];
  },

  // Mint a challenge. `action` and `detail` are what the device will display.
  'POST /api/pteri/challenge': async (body) => {
    if (!body.action || !body.detail) {
      return [400, { ok: false, code: 'missing_action_or_detail' }];
    }
    return [200, issueChallenge({
      origin: body.origin ?? RP_ORIGIN,
      action: body.action,
      detail: body.detail,
    })];
  },

  'POST /api/pteri/verify': async (body) => {
    const result = verifySignature({
      userId: body.userId ?? DEMO_USER,
      nonce: body.nonce,
      signatureB64: body.signature,
      expectedOrigin: RP_ORIGIN,
    });
    return [result.ok ? 200 : 401, result];
  },

  'POST /api/reset': async () => {
    resetOtp();
    resetVerifier();
    return [200, { ok: true }];
  },

  'GET /api/config': async () => [200, {
    rpOrigin: RP_ORIGIN,
    phishOrigin: PHISH_ORIGIN,
    demoUser: DEMO_USER,
  }],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];

  if (handler) {
    try {
      const body = req.method === 'GET' ? {} : await readJsonBody(req);
      const [status, payload] = await handler(body);
      return json(res, status, payload);
    } catch (err) {
      return json(res, 500, { error: 'internal', message: String(err?.message ?? err) });
    }
  }

  if (req.method === 'GET') return serveStatic(url.pathname, res);
  json(res, 405, { error: 'method_not_allowed' });
});

server.listen(PORT, () => {
  console.log(`\n  Phishing race demo → http://localhost:${PORT}\n`);
});
