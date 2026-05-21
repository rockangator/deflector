/**
 * Phase 3: LLM escalation for low-confidence matches and deep scans.
 * Only invoked when rules are insufficient — not for routine page loads.
 */

const TAXONOMY = [
  'urgency', 'scarcity', 'social_proof', 'misdirection',
  'trick_question', 'hidden_cost', 'disguised_ad',
];

/**
 * @param {import('./ruleEngine.js').Finding[]} ruleFindings
 * @param {{ element: Element, text: string, source: string }[]} candidates
 * @param {{ deep?: boolean, apiKey?: string }} options
 * @returns {Promise<import('./ruleEngine.js').Finding[]>}
 */
export async function escalateWithLlm(ruleFindings, candidates, options = {}) {
  const lowConfidence = ruleFindings.filter((f) => f.confidence >= 0.5 && f.confidence < 0.8);
  const coveredTexts = new Set(ruleFindings.map((f) => f.matchedText.toLowerCase()));

  let snippets = [];

  if (options.deep) {
    snippets = candidates
      .map((c) => c.text)
      .filter((t) => t.length >= 15 && t.length <= 300)
      .slice(0, 10);
  } else {
    snippets = lowConfidence.map((f) => f.matchedText);
    const extra = candidates
      .map((c) => c.text)
      .filter((t) => !coveredTexts.has(t.toLowerCase()) && t.length >= 20 && t.length <= 200)
      .slice(0, Math.max(0, 10 - snippets.length));
    snippets = [...snippets, ...extra];
  }

  if (snippets.length === 0) return [];

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_ESCALATE',
      snippets,
      deep: !!options.deep,
    });

    if (!response?.findings?.length) return [];

    return response.findings.map((f, i) => ({
      id: `llm-${i}-${Date.now()}`,
      category: f.category,
      matchedText: f.text,
      confidence: f.confidence ?? 0.75,
      ruleId: 'llm-escalation',
      explanation: f.explanation || 'Flagged by deep semantic scan.',
      rewrite: f.rewrite || 'Review this content independently.',
      source: 'llm',
      tier: 'llm',
    }));
  } catch {
    return [];
  }
}

/**
 * @param {import('./ruleEngine.js').Finding[]} findings
 */
export function mergeFindings(ruleFindings, llmFindings) {
  const seen = new Set(ruleFindings.map((f) => f.matchedText.toLowerCase()));
  const merged = [...ruleFindings];

  for (const f of llmFindings) {
    const key = f.matchedText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }

  return merged.sort((a, b) => b.confidence - a.confidence);
}

export { TAXONOMY };
