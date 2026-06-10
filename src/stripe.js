// ME COIN — Stripe via raw fetch (form-encoded). The stripe npm SDK is forbidden
// (ARCHITECTURE.md §9). Also: manual webhook signature verification + shared
// constant-time string compare.

const STRIPE_API = 'https://api.stripe.com';

export class StripeError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
  }
}

async function stripeFetch(env, method, path, params) {
  const init = {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  };
  if (params) {
    const body = new URLSearchParams();
    for (const [key, value] of params) body.append(key, String(value));
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = body.toString();
  }
  const res = await fetch(STRIPE_API + path, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body; fall through with data = null
  }
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new StripeError(res.status, `stripe ${method} ${path} failed: ${message}`);
  }
  return data;
}

/** POST to Stripe. `params` is an array of [key, value] pairs (preserves bracket syntax). */
export const stripePost = (env, path, params) => stripeFetch(env, 'POST', path, params);

/** GET from Stripe. */
export const stripeGet = (env, path) => stripeFetch(env, 'GET', path, null);

const encoder = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (no early exit on content mismatch). */
export function timingSafeEqualStr(a, b) {
  const ab = encoder.encode(String(a));
  const bb = encoder.encode(String(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Manual Stripe webhook signature verification (ARCHITECTURE.md §4.13):
 * parse `t=...,v1=...` from the stripe-signature header, HMAC-SHA256 over
 * `${t}.${rawBody}` with the webhook signing secret via SubtleCrypto,
 * constant-time compare, reject stale timestamps (|now/1000 − t| > 300 s).
 */
export async function verifyStripeSignature(rawBody, sigHeader, secret, nowMs = Date.now()) {
  if (!sigHeader || !secret) return false;

  let t = null;
  const v1s = [];
  for (const part of sigHeader.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't') t = value;
    else if (key === 'v1') v1s.push(value);
  }
  if (!t || !/^\d+$/.test(t) || v1s.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > 300) return false; // stale (>5 min)

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${rawBody}`));
  const expected = hex(mac);

  let ok = false;
  for (const candidate of v1s) ok = timingSafeEqualStr(candidate, expected) || ok;
  return ok;
}
