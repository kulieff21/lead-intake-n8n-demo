// Rule-score factors for the live lead, computed by the same library the workflow runs.
// Writes results/live-rule-breakdown.json (no address); checks it matches the live run's row.
import { writeFileSync, readFileSync } from 'node:fs';
import { config } from './common.mjs';
import { loadLib } from '../tests/load.mjs';
import { LIVE_LEAD } from './live-lead.mjs';

const L = loadLib();
const n = L.normalizeLead({ ...LIVE_LEAD, email: config().liveLeadEmail }, new Date().toISOString());
if (!n.ok) throw new Error(`lead invalid: ${n.errors}`);
const rule = L.ruleScore(n.lead);
const live = JSON.parse(readFileSync('results/live-2026-09-27.json', 'utf8'));
if (String(rule.score) !== live.row.rule_score) throw new Error(`rule ${rule.score} != live ${live.row.rule_score}`);
const out = { lead: 'tools/live-lead.mjs', mailbox: n.lead.free_mail ? 'free' : 'company', score: rule.score, factors: rule.factors };
writeFileSync('results/live-rule-breakdown.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
