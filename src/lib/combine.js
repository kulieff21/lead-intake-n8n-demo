// Combine the rule score and the LLM's opinion into one decision for the human reviewer.

const DISAGREEMENT = 35;

function combineScores(rule, aiResult) {
  const reasons = [];
  let final;
  if (aiResult.ok) {
    final = Math.round(0.4 * rule.score + 0.6 * aiResult.ai.fit_score);
    if (Math.abs(rule.score - aiResult.ai.fit_score) >= DISAGREEMENT) {
      reasons.push(`rule ${rule.score} vs AI ${aiResult.ai.fit_score}`);
    }
    if (aiResult.ai.red_flags.length) reasons.push(`red flags: ${aiResult.ai.red_flags.join('; ')}`);
    if (aiResult.ai.intent !== 'new_project') reasons.push(`intent ${aiResult.ai.intent}`);
  } else {
    final = rule.score;
    reasons.push(`AI unavailable (${aiResult.error}); rule score only`);
  }
  const tier = final >= 70 ? 'hot' : final >= 40 ? 'warm' : 'cold';
  return { final_score: final, tier, needs_review: reasons.length > 0, review_reasons: reasons };
}
