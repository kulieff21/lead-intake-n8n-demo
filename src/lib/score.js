// Deterministic rule score (0-100) with the reason for every point, so a reviewer can see why.
// The LLM score is a second opinion; this one never depends on a network call.

const BUDGET_POINTS = { '<1k': 5, '1k-5k': 20, '5k-20k': 30, '20k+': 35, unknown: 8 };
const TIMELINE_POINTS = { asap: 20, '1-3 months': 15, '3+ months': 6, exploring: 2, unknown: 5 };

function ruleScore(lead) {
  const factors = [];
  const add = (factor, points) => { if (points) factors.push({ factor, points }); };

  add(`budget ${lead.budget}`, BUDGET_POINTS[lead.budget] ?? 0);
  add(`timeline ${lead.timeline}`, TIMELINE_POINTS[lead.timeline] ?? 0);
  add(lead.free_mail ? 'free mailbox' : 'company mailbox', lead.free_mail ? 0 : 15);
  add('company named', lead.company ? 8 : 0);
  add('website given', lead.website ? 5 : 0);
  add('phone given', lead.phone ? 5 : 0);

  const words = lead.message.split(/\s+/).filter(Boolean).length;
  add(`message ${words} words`, words >= 40 ? 12 : words >= 15 ? 7 : 2);

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  return { score, factors };
}
