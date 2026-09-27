// One live lead through the real services: Google Sheets, the LLM, a real Telegram bot and a
// real SMTP mailbox. A person approves or rejects in Telegram; this script only watches.
// Writes results/live-<date>.json with addresses masked.
// Before sending, removes an earlier live row for the same lead key so the run starts clean.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { N8N, config, readTab, sheets, sleep } from './common.mjs';
import { loadLib } from '../tests/load.mjs';
import { LIVE_LEAD } from './live-lead.mjs';

const cfg = config();
// FORM_BASE: the public tunnel URL, so the form arrives from outside (default: local n8n).
const FORM_BASE = (process.env.FORM_BASE ?? N8N).replace(/\/$/, '');
const viaTunnel = FORM_BASE !== N8N;
const L = loadLib();
const email = cfg.liveLeadEmail;
const key = L.leadKey(email);
const mask = (s) => String(s).replace(/[a-z0-9._%+-]+@[a-z0-9.-]+/gi, (m) => (m.endsWith('.example') ? m : '<redacted>'));

const deployLine = execFileSync(process.execPath, ['tools/deploy.mjs', '--mode', 'live'], { encoding: 'utf8' }).trim().split('\n').pop();
console.log(deployLine);
await sleep(5000);

// Clean slate: delete an earlier row with this key (dedup would otherwise just count a repeat).
const meta = await sheets(`${cfg.sheetId}?fields=sheets.properties`);
const tabId = meta.sheets.find((s) => s.properties.title === 'leads').properties.sheetId;
const rows = await readTab(cfg.sheetId, 'leads');
const idx = rows.findIndex((r) => r.lead_key === key);
if (idx >= 0) {
  await sheets(`${cfg.sheetId}:batchUpdate`, { method: 'POST', body: { requests: [{ deleteDimension: { range: { sheetId: tabId, dimension: 'ROWS', startIndex: idx + 1, endIndex: idx + 2 } } }] } });
  console.log('removed earlier live row');
}

const lead = { ...LIVE_LEAD, email };
const t0 = Date.now();
const r = await fetch(`${FORM_BASE}/webhook/lead-intake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lead) });
const ack = { status: r.status, ms: Date.now() - t0 };
console.log(`form → ${ack.status} in ${ack.ms} ms. Approve or reject in Telegram now (waiting up to 15 min)…`);

let row;
const marks = {};
for (;;) {
  row = (await readTab(cfg.sheetId, 'leads')).find((x) => x.lead_key === key);
  if (row?.status === 'pending_approval' && !marks.pending) { marks.pending = Date.now() - t0; console.log(`row pending_approval after ${marks.pending} ms (rule ${row.rule_score}, AI ${row.ai_fit_score}, final ${row.final_score} ${row.tier})`); }
  if (row && ['replied', 'rejected', 'approved_no_reply'].includes(row.status)) { marks.decided = Date.now() - t0; break; }
  if (Date.now() - t0 > 15 * 60_000) break;
  await sleep(3000);
}
const out = {
  at: new Date().toISOString(),
  mode: viaTunnel ? 'live, public tunnel (form posted to the public URL, approval link opened on a phone)' : 'live, local webhook (no tunnel)',
  services: { sheets: 'real', llm: cfg.aiModel, telegram: 'real bot', smtp: `real (${cfg.smtp.host})` },
  ack, marks,
  row: row && Object.fromEntries(['status', 'rule_score', 'ai_fit_score', 'final_score', 'tier', 'needs_review', 'intent', 'summary', 'reply_draft', 'decision', 'decided_at', 'replied_at'].map((k) => [k, mask(row[k])])),
};
mkdirSync('results', { recursive: true });
writeFileSync(`results/live-${out.at.slice(0, 10)}.json`, JSON.stringify(out, null, 2) + '\n');
console.log(row ? `final status: ${row.status}` : 'no row');
