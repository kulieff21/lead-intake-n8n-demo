// Build the n8n workflow JSON from src/lib. Output has placeholders instead of instance data
// (sheet id, chat id, addresses, credential ids); tools/deploy.mjs fills them in.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const LIB = ['normalize.js', 'score.js', 'ai.js', 'combine.js', 'crm.js']
  .map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8'))
  .join('\n');
const { LEAD_COLUMNS } = await import('../tests/load.mjs').then((m) => m.loadLib());

export const PH = {
  sheetId: '__SHEET_ID__',
  chatId: '__TELEGRAM_CHAT_ID__',
  fromEmail: '__FROM_EMAIL__',
  aiBaseUrl: '__AI_BASE_URL__',
  aiModel: '__AI_MODEL__',
};
export const CREDS = {
  sheets: { type: 'googleApi', name: 'Google Sheets (service account)' },
  openrouter: { type: 'httpHeaderAuth', name: 'OpenRouter' },
  telegram: { type: 'telegramApi', name: 'Telegram reviewer bot' },
  smtp: { type: 'smtp', name: 'SMTP outbound' },
};
const cred = (k) => ({ [CREDS[k].type]: { id: `__CRED_${k.toUpperCase()}__`, name: CREDS[k].name } });

const code = (body) => ({ mode: 'runOnceForEachItem', jsCode: `${LIB}\n// ---- node ----\n${body}` });
const cond = (leftValue, operator, rightValue = '') => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: [{ id: `c-${Math.abs(hash(leftValue))}`, leftValue, rightValue, operator }],
  combinator: 'and',
});
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
const isTrue = { type: 'boolean', operation: 'true', singleValue: true };
const strEq = { type: 'string', operation: 'equals' };

const doc = { __rl: true, mode: 'id', value: PH.sheetId };
const tab = (name) => ({ __rl: true, mode: 'name', value: name });
const schema = (cols) => cols.map((id) => ({
  id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true,
}));
const sheetWrite = (operation, value, sheet = 'leads') => ({
  authentication: 'serviceAccount',
  resource: 'sheet',
  operation,
  documentId: doc,
  sheetName: tab(sheet),
  columns: {
    mappingMode: 'defineBelow',
    value,
    matchingColumns: operation === 'append' ? [] : ['lead_key'],
    schema: schema(Object.keys(value)),
  },
  options: {},
});
const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };

let seq = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) =>
  ({ id: `n${String(++seq).padStart(2, '0')}`, name, type, typeVersion, position, parameters, ...extra });

// ---------------- main workflow ----------------
const now = "={{ new Date().toISOString() }}";
const lead = "$('Normalize').item.json.lead";
const main = [
  node('Form webhook', 'n8n-nodes-base.webhook', 2.1, [0, 300],
    { httpMethod: 'POST', path: 'lead-intake', responseMode: 'responseNode', options: {} },
    { webhookId: '6f1c2a3e-lead-4ake-9d10-kestrelvale01' }),
  node('Normalize', 'n8n-nodes-base.code', 2, [220, 300], code(
    'const r = normalizeLead($json.body, new Date().toISOString());\nreturn { json: r };')),
  node('Route', 'n8n-nodes-base.switch', 3.4, [440, 300], {
    rules: { values: [
      { conditions: cond('={{ $json.spam }}', isTrue), renameOutput: true, outputKey: 'spam' },
      { conditions: cond('={{ $json.ok }}', isTrue), renameOutput: true, outputKey: 'valid' },
    ] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'invalid' },
  }),
  node('Ack spam silently', 'n8n-nodes-base.respondToWebhook', 1.5, [660, 100],
    { respondWith: 'json', responseBody: '={{ JSON.stringify({ status: "received" }) }}', options: { responseCode: 202 } }),
  node('Accept', 'n8n-nodes-base.respondToWebhook', 1.5, [660, 300],
    { respondWith: 'json', responseBody: '={{ JSON.stringify({ status: "received" }) }}', options: { responseCode: 202 } }),
  node('Reject invalid', 'n8n-nodes-base.respondToWebhook', 1.5, [660, 500],
    { respondWith: 'json', responseBody: '={{ JSON.stringify({ status: "invalid", errors: $json.errors }) }}', options: { responseCode: 422 } }),
  node('Find in CRM', 'n8n-nodes-base.googleSheets', 4.7, [880, 300], {
    authentication: 'serviceAccount', resource: 'sheet', operation: 'read', documentId: doc, sheetName: tab('leads'),
    filtersUI: { values: [{ lookupColumn: 'lead_key', lookupValue: `={{ ${lead}.lead_key }}` }] },
    options: {},
  }, { credentials: cred('sheets'), alwaysOutputData: true, ...retry }),
  node('Seen before?', 'n8n-nodes-base.if', 2.3, [1100, 300],
    { conditions: cond('={{ !!$json.lead_key }}', isTrue), options: {} }),
  node('Count repeat', 'n8n-nodes-base.googleSheets', 4.7, [1320, 140], sheetWrite('update', {
    lead_key: '={{ $json.lead_key }}',
    last_seen_at: now,
    submissions: '={{ Number($json.submissions || 1) + 1 }}',
  }), { credentials: cred('sheets'), ...retry }),
  node('Rule score', 'n8n-nodes-base.code', 2, [1320, 400], code(
    `const lead = ${lead};\nconst rule = ruleScore(lead);\n` +
    `return { json: { lead, rule, ai_request: buildAiRequest(lead, '${PH.aiModel}') } };`)),
  node('Ask LLM', 'n8n-nodes-base.httpRequest', 4.2, [1540, 400], {
    method: 'POST', url: `${PH.aiBaseUrl}/chat/completions`,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.ai_request) }}',
    options: { timeout: 30000 },
  }, { credentials: cred('openrouter'), ...retry, onError: 'continueRegularOutput' }),
  node('Assess', 'n8n-nodes-base.code', 2, [1760, 400], code(
    "const { lead, rule } = $('Rule score').item.json;\n" +
    "const aiResult = $json.error ? { ok: false, ai: null, error: 'http: ' + String($json.error.message || $json.error).slice(0, 80) } : parseAiResponse($json);\n" +
    'const combined = combineScores(rule, aiResult);\n' +
    'const row = newLeadRow(lead, rule, aiResult, combined, $execution.id);\n' +
    'const message = approvalMessage(row, rule, $execution.resumeUrl);\n' +
    'return { json: { row, message } };')),
  node('Save to CRM', 'n8n-nodes-base.googleSheets', 4.7, [1980, 400],
    sheetWrite('appendOrUpdate', Object.fromEntries(LEAD_COLUMNS.map((c) => [c, `={{ $json.row.${c} }}`]))),
    { credentials: cred('sheets'), ...retry }),
  node('Ask reviewer', 'n8n-nodes-base.telegram', 1.2, [2200, 400], {
    resource: 'message', operation: 'sendMessage', chatId: PH.chatId,
    text: "={{ $('Assess').item.json.message.text }}",
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: { rows: [{ row: { buttons: [
      { text: '✅ Approve & send', additionalFields: { url: "={{ $('Assess').item.json.message.approveUrl }}" } },
      { text: '❌ Reject', additionalFields: { url: "={{ $('Assess').item.json.message.rejectUrl }}" } },
    ] } }] },
    additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true },
  }, { credentials: cred('telegram'), ...retry }),
  node('Wait for decision', 'n8n-nodes-base.wait', 1.1, [2420, 400], {
    resume: 'webhook', httpMethod: 'GET', limitWaitTime: true, limitType: 'afterTimeInterval',
    resumeAmount: 48, resumeUnit: 'hours', options: {},
  }, { webhookId: '0b7d5c1e-wait-4dec-8a11-kestrelvale02' }),
  node('Decision', 'n8n-nodes-base.switch', 3.4, [2640, 400], {
    rules: { values: [
      { conditions: cond("={{ $json.query && $json.query.decision }}", strEq, 'approve'), renameOutput: true, outputKey: 'approve' },
      { conditions: cond("={{ $json.query && $json.query.decision }}", strEq, 'reject'), renameOutput: true, outputKey: 'reject' },
    ] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'expired' },
  }),
  node('Has draft?', 'n8n-nodes-base.if', 2.3, [2860, 240],
    { conditions: cond("={{ !!$('Assess').item.json.row.reply_draft }}", isTrue), options: {} }),
  node('Send reply', 'n8n-nodes-base.emailSend', 2.1, [3080, 140], {
    fromEmail: PH.fromEmail,
    toEmail: "={{ $('Assess').item.json.row.email }}",
    subject: 'Re: your inquiry to Kestrel & Vale Studio',
    emailFormat: 'text',
    text: "={{ $('Assess').item.json.row.reply_draft }}",
    options: { appendAttribution: false },
  }, { credentials: cred('smtp'), ...retry }),
  node('Mark replied', 'n8n-nodes-base.googleSheets', 4.7, [3300, 140], sheetWrite('update', {
    lead_key: "={{ $('Assess').item.json.row.lead_key }}",
    status: 'replied', decision: 'approve', decided_at: now, replied_at: now,
  }), { credentials: cred('sheets'), ...retry }),
  node('Mark approved (no draft)', 'n8n-nodes-base.googleSheets', 4.7, [3080, 340], sheetWrite('update', {
    lead_key: "={{ $('Assess').item.json.row.lead_key }}",
    status: 'approved_no_reply', decision: 'approve', decided_at: now,
  }), { credentials: cred('sheets'), ...retry }),
  node('Mark rejected', 'n8n-nodes-base.googleSheets', 4.7, [2860, 480], sheetWrite('update', {
    lead_key: "={{ $('Assess').item.json.row.lead_key }}",
    status: 'rejected', decision: 'reject', decided_at: now,
  }), { credentials: cred('sheets'), ...retry }),
  node('Mark expired', 'n8n-nodes-base.googleSheets', 4.7, [2860, 660], sheetWrite('update', {
    lead_key: "={{ $('Assess').item.json.row.lead_key }}",
    status: 'expired', decided_at: now,
  }), { credentials: cred('sheets'), ...retry }),
  node('Confirm to reviewer', 'n8n-nodes-base.telegram', 1.2, [3520, 140], {
    resource: 'message', operation: 'sendMessage', chatId: PH.chatId,
    text: "=Reply sent to {{ $('Assess').item.json.row.email }} ✅",
    additionalFields: { appendAttribution: false },
  }, { credentials: cred('telegram'), ...retry }),
];

const link = (from, to, out = 0) => ({ from, to, out });
const edges = [
  link('Form webhook', 'Normalize'), link('Normalize', 'Route'),
  link('Route', 'Ack spam silently', 0), link('Route', 'Accept', 1), link('Route', 'Reject invalid', 2),
  link('Accept', 'Find in CRM'), link('Find in CRM', 'Seen before?'),
  link('Seen before?', 'Count repeat', 0), link('Seen before?', 'Rule score', 1),
  link('Rule score', 'Ask LLM'), link('Ask LLM', 'Assess'), link('Assess', 'Save to CRM'),
  link('Save to CRM', 'Ask reviewer'), link('Ask reviewer', 'Wait for decision'), link('Wait for decision', 'Decision'),
  link('Decision', 'Has draft?', 0), link('Decision', 'Mark rejected', 1), link('Decision', 'Mark expired', 2),
  link('Has draft?', 'Send reply', 0), link('Has draft?', 'Mark approved (no draft)', 1),
  link('Send reply', 'Mark replied'), link('Mark replied', 'Confirm to reviewer'),
];
function connections(list) {
  const c = {};
  for (const { from, to, out } of list) {
    c[from] ??= { main: [] };
    while (c[from].main.length <= out) c[from].main.push([]);
    c[from].main[out].push({ node: to, type: 'main', index: 0 });
  }
  return c;
}

const mainWf = {
  name: 'Lead intake (Kestrel & Vale demo)',
  nodes: main,
  connections: connections(edges),
  settings: { executionOrder: 'v1', errorWorkflow: '__ERROR_WORKFLOW_ID__', saveManualExecutions: true },
};

// ---------------- error workflow ----------------
seq = 100;
const errorWf = {
  name: 'Lead intake errors (Kestrel & Vale demo)',
  nodes: [
    node('On workflow error', 'n8n-nodes-base.errorTrigger', 1, [0, 300], {}),
    node('Alert reviewer', 'n8n-nodes-base.telegram', 1.2, [240, 200], {
      resource: 'message', operation: 'sendMessage', chatId: PH.chatId,
      text: '=⛔ Lead intake failed at "{{ $json.execution.lastNodeExecuted }}": {{ $json.execution.error.message }}\nExecution {{ $json.execution.id }}',
      additionalFields: { appendAttribution: false },
    }, { credentials: cred('telegram'), ...retry, onError: 'continueRegularOutput' }),
    node('Log error', 'n8n-nodes-base.googleSheets', 4.7, [240, 400], sheetWrite('append', {
      at: now,
      execution_id: '={{ $json.execution.id }}',
      node: '={{ $json.execution.lastNodeExecuted }}',
      message: '={{ $json.execution.error.message }}',
    }, 'errors'), { credentials: cred('sheets'), ...retry }),
  ],
  connections: connections([link('On workflow error', 'Alert reviewer'), link('On workflow error', 'Log error')]),
  settings: { executionOrder: 'v1' },
};

mkdirSync(new URL('../workflows/', import.meta.url), { recursive: true });
writeFileSync(new URL('../workflows/lead-intake.json', import.meta.url), JSON.stringify(mainWf, null, 2) + '\n');
writeFileSync(new URL('../workflows/lead-intake-errors.json', import.meta.url), JSON.stringify(errorWf, null, 2) + '\n');
console.log(`built: ${mainWf.nodes.length} + ${errorWf.nodes.length} nodes`);
