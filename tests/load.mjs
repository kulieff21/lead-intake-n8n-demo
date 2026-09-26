// Load the plain-script libs the same way the Code nodes see them: one shared scope.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const LIB_FILES = ['normalize.js', 'score.js', 'ai.js', 'combine.js', 'crm.js'];

export function loadLib() {
  const ctx = vm.createContext({});
  for (const f of LIB_FILES) {
    vm.runInContext(readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext(
    '({ normalizeLead, leadKey, ruleScore, buildAiRequest, parseAiResponse, combineScores, newLeadRow, approvalMessage, LEAD_COLUMNS, AI_SCHEMA })',
    ctx,
  );
}
