'use strict';

const PROFANITY = ['幹你', '操你', '靠北你', '媽的你', '去死'];

function inspectResponse(reply, { allowProfanity = false, questionBudget = 1 } = {}) {
  const text = String(reply || '').trim();
  const warnings = [];
  const questionCount = (text.match(/[？?]/g) || []).length;

  if (!text) warnings.push('empty_reply');
  if (questionCount > questionBudget + 1) warnings.push('too_many_questions');
  if (!allowProfanity && PROFANITY.some((word) => text.includes(word))) warnings.push('profanity');
  if (/Understanding Brief|Guidance Brief|followUpGap|questionBudget|目前需求分數/.test(text)) {
    warnings.push('leaked_internal_state');
  }

  return {
    ok: warnings.length === 0,
    warnings,
    text,
  };
}

function sanitizeResponse(reply, { allowProfanity = false } = {}) {
  let text = String(reply || '').trim();
  text = text.replace(/【?(?:Understanding|Guidance) Brief】?[\s\S]*/gi, '').trim();
  if (!allowProfanity) {
    for (const word of PROFANITY) text = text.split(word).join('欸');
  }
  return text;
}

module.exports = {
  inspectResponse,
  sanitizeResponse,
};
