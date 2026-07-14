'use strict';

const DEFAULT_BLOCKED_PHRASES = [
  '我將協助你',
  '請問需要什麼服務',
  '根據你的情緒',
  '你的心理狀態顯示',
  '建議你進行情緒梳理',
];

const PROFANITY_PATTERNS = [
  /幹你/gi,
  /操你/gi,
  /他媽的/gi,
  /媽的/gi,
  /fuck\s*you/gi,
];

function safeText(value) {
  return String(value || '').trim();
}

function countQuestionMarks(text) {
  const matches = safeText(text).match(/[?？]/g);
  return matches ? matches.length : 0;
}

function inspectResponse(
  rawReply,
  {
    allowProfanity = false,
    questionBudget = 1,
  } = {},
) {
  const text = safeText(rawReply);
  const warnings = [];

  if (!text) {
    warnings.push('empty_reply');
  }

  const questionCount = countQuestionMarks(text);
  if (questionCount > Math.max(0, Number(questionBudget || 0))) {
    warnings.push(`too_many_questions:${questionCount}`);
  }

  for (const phrase of DEFAULT_BLOCKED_PHRASES) {
    if (text.includes(phrase)) {
      warnings.push(`robotic_phrase:${phrase}`);
    }
  }

  if (!allowProfanity) {
    for (const pattern of PROFANITY_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        warnings.push('profanity_detected');
        break;
      }
    }
  }

  if (text.length > 1200) {
    warnings.push(`reply_too_long:${text.length}`);
  }

  return {
    ok: warnings.length === 0,
    warnings,
    questionCount,
    length: text.length,
  };
}

function sanitizeResponse(
  rawReply,
  {
    allowProfanity = false,
  } = {},
) {
  let text = safeText(rawReply);

  if (!text) return '';

  // 不讓模型把內部標記直接露給使用者
  text = text
      .replace(/\[(?:MOMO|SYSTEM|BRIEF|GUIDANCE|UNDERSTANDING)[^\]]*\]/gi, '')
      .replace(/【(?:Understanding Brief|Guidance Brief|Momo Brief|系統提示)[^】]*】/gi, '')
      .trim();

  if (!allowProfanity) {
    for (const pattern of PROFANITY_PATTERNS) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, '真的很過分');
    }
  }

  // 避免 API 偶爾回傳多餘空白
  text = text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();

  return text;
}

module.exports = {
  inspectResponse,
  sanitizeResponse,
};
