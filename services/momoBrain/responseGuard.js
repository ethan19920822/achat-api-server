'use strict';

function inspectResponse(value, { questionBudget = 1 } = {}) {
  const text = String(value || '').trim();
  const warnings = [];
  if (!text) warnings.push('empty_reply');
  const questions = (text.match(/[？?]/g) || []).length;
  if (questions > Math.max(1, Number(questionBudget || 1))) warnings.push(`too_many_questions:${questions}`);
  if (text.length > 900) warnings.push(`very_long_reply:${text.length}`);
  return { ok: warnings.length === 0, warnings };
}

function sanitizeResponse(value) {
  return String(value || '')
    .replace(/作為一個AI[^。！？]*[。！？]?/gi, '')
    .replace(/作為人工智慧[^。！？]*[。！？]?/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { inspectResponse, sanitizeResponse };
