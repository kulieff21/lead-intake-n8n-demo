// Shared helpers for deploy and e2e: secrets, the n8n public API, and a tiny Google Sheets client.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';

export const SECRETS = process.env.LEAD_SECRETS_DIR ?? 'D:/ronin-work/secrets';
export const STATE_FILE = process.env.LEAD_STATE_FILE ?? 'D:/ronin-work/n8n/state/lead-intake.json';
export const N8N = process.env.N8N_BASE ?? 'http://localhost:5678';

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const secret = (name) => readJson(`${SECRETS}/${name}`);
export const config = () => secret('lead-intake.json');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadState() {
  return existsSync(STATE_FILE) ? readJson(STATE_FILE) : { creds: {}, workflows: {} };
}
export function saveState(s) {
  mkdirSync(STATE_FILE.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export async function api(path, { method = 'GET', body } = {}) {
  const { apiKey } = secret('n8n-local.json');
  const r = await fetch(`${N8N}/api/v1${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: r.status, ok: r.ok, json, text };
}

// ---- Google Sheets via service account (JWT bearer), no SDK ----
let token = null;
async function googleToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const sa = secret('invoice-sa.json');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`google token: ${r.status} ${JSON.stringify(j)}`);
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

export async function sheets(path, { method = 'GET', body } = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    headers: { authorization: `Bearer ${await googleToken()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`sheets ${method} ${path.split('?')[0]}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// Rows of a tab as objects keyed by the header row.
export async function readTab(sheetId, tab) {
  const j = await sheets(`${sheetId}/values/${encodeURIComponent(tab)}`);
  const [header = [], ...rows] = j.values ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
