// Deploy to the local n8n: prepare the CRM sheet, create/refresh credentials, fill the
// placeholders in workflows/*.json, (re)publish, and wait until the webhook is registered.
// Flags: --ai-base-url <url>  override the LLM endpoint (used by the e2e failure scenario).
//        --sheet-id <id>      override the sheet id (used by the e2e error scenario).
//        --smtp-port <port>   override the SMTP port (e2e: mail server down).
//        --wait-minutes <n>   approval window in minutes instead of 48 h (e2e: expiry).
//        --mode dev|live      mock or real Telegram/SMTP (default: config "mode").
//        --skip-sheet         do not touch the spreadsheet (dry deploy before it exists).
import { readFileSync } from 'node:fs';
import { N8N, api, config, secret, loadState, saveState, sheets, sleep } from './common.mjs';
import { loadLib } from '../tests/load.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = config();
// --mode dev: mock Telegram/SMTP from the *_dev settings (tools/e2e.mjs); live: the real ones.
const mode = flag('--mode') ?? base.mode ?? 'dev';
if (!['dev', 'live'].includes(mode)) throw new Error(`unknown mode ${mode}`);
const cfg = mode === 'dev'
  ? { ...base, telegram: base.telegram_dev ?? base.telegram, smtp: base.smtp_dev ?? base.smtp, fromEmail: base.fromEmail_dev ?? base.fromEmail }
  : base;
const aiBaseUrl = flag('--ai-base-url') ?? cfg.aiBaseUrl;
const state = loadState();

const ERROR_COLUMNS = ['at', 'execution_id', 'node', 'message'];

async function ensureSheet() {
  const { LEAD_COLUMNS } = loadLib();
  const meta = await sheets(`${cfg.sheetId}?fields=sheets.properties`);
  const have = meta.sheets.map((s) => s.properties.title);
  const add = ['leads', 'errors'].filter((t) => !have.includes(t));
  if (add.length) {
    await sheets(`${cfg.sheetId}:batchUpdate`, { method: 'POST', body: { requests: add.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) } });
  }
  for (const [tab, cols] of [['leads', [...LEAD_COLUMNS]], ['errors', ERROR_COLUMNS]]) {
    const cur = (await sheets(`${cfg.sheetId}/values/${tab}!1:1`)).values?.[0] ?? [];
    if (cur.join('|') !== cols.join('|')) {
      if (cur.length) throw new Error(`sheet tab "${tab}" has a different header; refusing to overwrite`);
      await sheets(`${cfg.sheetId}/values/${tab}!A1?valueInputOption=RAW`, { method: 'PUT', body: { values: [cols] } });
    }
  }
  console.log(`sheet ok (${add.length ? 'added ' + add.join(', ') : 'tabs present'})`);
}

function credentialData() {
  const sa = secret('invoice-sa.json');
  const key = readFileSync(`${process.env.LEAD_SECRETS_DIR ?? 'D:/ronin-work/secrets'}/openrouter.key`, 'utf8').trim();
  return {
    sheets: { type: 'googleApi', name: 'Google Sheets (service account)', data: { email: sa.client_email, privateKey: sa.private_key } },
    openrouter: { type: 'httpHeaderAuth', name: 'OpenRouter', data: { name: 'Authorization', value: `Bearer ${key}` } },
    telegram: { type: 'telegramApi', name: 'Telegram reviewer bot', data: { accessToken: cfg.telegram.token, baseUrl: cfg.telegram.baseUrl ?? 'https://api.telegram.org' } },
    smtp: { type: 'smtp', name: 'SMTP outbound', data: { user: cfg.smtp.user, password: cfg.smtp.password, host: cfg.smtp.host, port: Number(flag('--smtp-port') ?? cfg.smtp.port), secure: !!cfg.smtp.secure, disableStartTls: !!cfg.smtp.disableStartTls } },
  };
}

async function ensureCredentials() {
  for (const [k, c] of Object.entries(credentialData())) {
    // Update in place: ids stay stable, so executions already running keep working.
    if (state.creds[k]) {
      const u = await api(`/credentials/${state.creds[k]}`, { method: 'PATCH', body: c });
      if (u.ok) continue;
      if (u.status !== 404) throw new Error(`credential ${k} update: ${u.status} ${u.text.slice(0, 300)}`);
    }
    const r = await api('/credentials', { method: 'POST', body: c });
    if (!r.ok) throw new Error(`credential ${k}: ${r.status} ${r.text.slice(0, 300)}`);
    state.creds[k] = r.json.id;
  }
  saveState(state);
  console.log('credentials ok');
}

function fill(file, extra = {}) {
  let text = readFileSync(new URL(`../workflows/${file}`, import.meta.url), 'utf8');
  const subs = {
    __SHEET_ID__: flag('--sheet-id') ?? cfg.sheetId, __TELEGRAM_CHAT_ID__: String(cfg.telegram.chatId), __FROM_EMAIL__: cfg.fromEmail,
    __AI_BASE_URL__: aiBaseUrl, __AI_MODEL__: cfg.aiModel,
    __CRED_SHEETS__: state.creds.sheets, __CRED_OPENROUTER__: state.creds.openrouter,
    __CRED_TELEGRAM__: state.creds.telegram, __CRED_SMTP__: state.creds.smtp, ...extra,
  };
  for (const [k, v] of Object.entries(subs)) text = text.split(k).join(JSON.stringify(String(v)).slice(1, -1));
  const left = text.match(/__[A-Z_]+__/g);
  if (left) throw new Error(`${file}: unfilled placeholders ${[...new Set(left)].join(', ')}`);
  const wf = JSON.parse(text);
  const waitMin = flag('--wait-minutes');
  for (const n of wf.nodes) if (waitMin && n.type === 'n8n-nodes-base.wait') Object.assign(n.parameters, { resumeAmount: Number(waitMin), resumeUnit: 'minutes' });
  return { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
}

async function upsertWorkflow(key, body, activate) {
  const id = state.workflows[key];
  if (id) {
    await api(`/workflows/${id}/deactivate`, { method: 'POST' });
    const r = await api(`/workflows/${id}`, { method: 'PUT', body });
    if (!r.ok) throw new Error(`update ${key}: ${r.status} ${r.text.slice(0, 400)}`);
  } else {
    const r = await api('/workflows', { method: 'POST', body });
    if (!r.ok) throw new Error(`create ${key}: ${r.status} ${r.text.slice(0, 400)}`);
    state.workflows[key] = r.json.id;
    saveState(state);
  }
  if (activate) {
    const r = await api(`/workflows/${state.workflows[key]}/activate`, { method: 'POST' });
    if (!r.ok) throw new Error(`activate ${key}: ${r.status} ${r.text.slice(0, 400)}`);
  }
  return state.workflows[key];
}

// Activation is asynchronous: poll until the production webhook answers something other than
// "not registered" (a GET to a POST-only hook says so explicitly).
async function waitForWebhook(path, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${N8N}/webhook/${path}`);
    const t = await r.text();
    if (!/is not registered\.|not registered for/.test(t) || /Did you mean to make a POST/.test(t)) {
      return Date.now() - t0;
    }
    await sleep(1000);
  }
  throw new Error(`webhook ${path} not registered after ${timeoutMs} ms`);
}

if (args.includes('--skip-sheet')) console.log('sheet skipped'); else await ensureSheet();
await ensureCredentials();
// n8n 2.x only runs an error workflow that is published (1.x did not require it).
const errId = await upsertWorkflow('errors', fill('lead-intake-errors.json'), true);
const mainId = await upsertWorkflow('main', fill('lead-intake.json', { __ERROR_WORKFLOW_ID__: errId }), true);
const ms = await waitForWebhook('lead-intake');
console.log(`deployed mode=${mode} main=${mainId} errors=${errId} ai=${aiBaseUrl} webhook live after ${ms} ms`);
