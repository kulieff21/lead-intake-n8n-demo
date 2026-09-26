// CRM row shape (Google Sheets "leads" tab) and the reviewer's Telegram message.

const LEAD_COLUMNS = [
  'lead_key', 'status', 'received_at', 'last_seen_at', 'submissions',
  'name', 'email', 'company', 'website', 'phone', 'budget', 'timeline', 'source', 'message',
  'rule_score', 'ai_fit_score', 'final_score', 'tier', 'needs_review', 'review_reasons',
  'ai_status', 'intent', 'summary', 'reply_draft', 'decision', 'decided_at', 'replied_at', 'execution_id',
];

function newLeadRow(lead, rule, aiResult, combined, executionId) {
  return {
    lead_key: lead.lead_key,
    status: 'pending_approval',
    received_at: lead.received_at,
    last_seen_at: lead.received_at,
    submissions: 1,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    website: lead.website,
    phone: lead.phone,
    budget: lead.budget,
    timeline: lead.timeline,
    source: lead.source,
    message: lead.message,
    rule_score: rule.score,
    ai_fit_score: aiResult.ok ? aiResult.ai.fit_score : '',
    final_score: combined.final_score,
    tier: combined.tier,
    needs_review: combined.needs_review ? 'yes' : 'no',
    review_reasons: combined.review_reasons.join(' | '),
    ai_status: aiResult.ok ? 'ok' : `failed: ${aiResult.error}`,
    intent: aiResult.ok ? aiResult.ai.intent : '',
    summary: aiResult.ok ? aiResult.ai.summary : '',
    reply_draft: aiResult.ok ? aiResult.ai.reply_draft : '',
    decision: '',
    decided_at: '',
    replied_at: '',
    execution_id: String(executionId ?? ''),
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram HTML message. Links are also in the text in case a client hides inline buttons.
function approvalMessage(row, rule, resumeUrl) {
  const sep = resumeUrl.includes('?') ? '&' : '?';
  const approveUrl = `${resumeUrl}${sep}decision=approve`;
  const rejectUrl = `${resumeUrl}${sep}decision=reject`;
  const flag = row.needs_review === 'yes' ? '⚠️ needs review: ' + escapeHtml(row.review_reasons) + '\n' : '';
  const lines = [
    `<b>New lead · ${row.tier.toUpperCase()} ${row.final_score}/100</b>`,
    `${escapeHtml(row.name)}${row.company ? ' · ' + escapeHtml(row.company) : ''} · ${escapeHtml(row.email)}`,
    `budget ${row.budget} · timeline ${row.timeline} · rule ${row.rule_score} · AI ${row.ai_fit_score === '' ? 'n/a' : row.ai_fit_score}`,
    flag + (row.summary ? `\n<i>${escapeHtml(row.summary)}</i>` : ''),
    row.reply_draft
      ? `\n<b>Reply draft</b>\n${escapeHtml(row.reply_draft)}`
      : '\nNo AI draft (AI unavailable). Approving will not send an email.',
    `\nApprove: ${approveUrl}\nReject: ${rejectUrl}`,
  ];
  return {
    text: lines.filter(Boolean).join('\n').slice(0, 4000),
    approveUrl,
    rejectUrl,
  };
}
