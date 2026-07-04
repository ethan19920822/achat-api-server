const axios = require('axios');
require('dotenv').config();

const {
  canCallAI,
  recordAIUsage,
  estimateTokensFromChars,
} = require('./aiUsageMonitor');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const ROUTE = '/drift/shield';
const SHIELD_VERSION = 'drift_shield_v1.0.0';
const MAX_TITLE_CHARS = 120;
const MAX_CONTENT_CHARS = 1600;
const MAX_PAYLOAD_CHARS = 7000;

function safeText(value) {
  return String(value || '').trim();
}

function clampText(value, max) {
  const text = safeText(value);
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function calcPenaltyFromRatio(ratio) {
  const r = clampNumber(ratio, 0, 1, 0);
  if (r < 0.10) return 0;
  return Math.max(-9, -Math.floor(r * 10));
}

function exposureWeightFromPenalty(oceanPenalty) {
  const p = Math.abs(clampNumber(oceanPenalty, -9, 0, 0));
  return clampNumber(1 - p * 0.1, 0.1, 1, 1);
}

function extractJsonObject(text) {
  const raw = safeText(text);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {}

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function fallbackShield({ title, content, reason = 'fallback' }) {
  return {
    title: clampText(title, MAX_TITLE_CHARS) || '一只漂流瓶',
    content: clampText(content, MAX_CONTENT_CHARS),
    anonymousChanged: false,
    profanityRatio: 0,
    oceanPenalty: 0,
    exposureWeight: 1,
    shieldVersion: SHIELD_VERSION,
    fallback: true,
    fallbackReason: reason,
  };
}

function buildSystemPrompt() {
  return `
You are Akasha Cube Drift Shield.

Your job is NOT to rewrite, polish, shorten, moralize, judge, summarize, or explain the story.

Your only jobs:
1. Preserve the user's original emotion, timeline, tone, and meaning.
2. Anonymize identifiable personal references:
   - real person names
   - nicknames that clearly identify a person
   - specific places
   - schools
   - companies
   - stores / restaurants / venues
   - hospitals / clinics
   - addresses
   - phone numbers
   - email addresses
   - social media handles
3. Replace them with soft generic wording in the same language.
   Examples:
   小明 -> 一位朋友
   Kevin -> 某個人
   宜蘭 -> 一座城市
   綠島 -> 一座小島
   台北車站 -> 一個很熱鬧的地方
   台積電 -> 一間公司
   成功高中 -> 一所學校
   星巴克 -> 一間咖啡店
4. Do NOT treat laughter or emotional repetition as profanity.
   哈哈哈、啊啊啊、哭哭、XDDD、LOL are NOT profanity.
5. Calculate profanityRatio from 0 to 1.
   Only count real profanity, insults, abusive words, vulgar attacks, or hateful abuse.
   Do not count normal sadness, anger, grief, laughter, crying, or emotional intensity.
6. oceanPenalty:
   profanityRatio < 0.10 => 0
   0.10 to 0.199 => -1
   0.20 to 0.299 => -2
   0.30 to 0.399 => -3
   0.40 to 0.499 => -4
   0.50 to 0.599 => -5
   0.60 to 0.699 => -6
   0.70 to 0.799 => -7
   0.80 to 0.899 => -8
   >= 0.90 => -9

Return ONLY valid JSON:
{
  "title": "protected title",
  "content": "protected content",
  "anonymousChanged": true,
  "profanityRatio": 0.0,
  "oceanPenalty": 0
}
`.trim();
}

function buildUserPrompt({ title, content }) {
  return `
Title:
${clampText(title, MAX_TITLE_CHARS)}

Content:
${clampText(content, MAX_CONTENT_CHARS)}
`.trim();
}

async function callDeepSeekShield({ userId, title, content }) {
  const startedAt = Date.now();

  if (!DEEPSEEK_API_KEY) {
    console.error('[DRIFT_SHIELD] DEEPSEEK_API_KEY missing');
    return '';
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt({ title, content }) },
  ];

  const payloadChars = JSON.stringify(messages).length;
  const estimatedTokens = estimateTokensFromChars(payloadChars);

  if (payloadChars > MAX_PAYLOAD_CHARS) {
    console.error('[DRIFT_SHIELD] payload too large', { payloadChars });
    return '';
  }

  const gate = canCallAI({
    userId: userId || 'anonymous',
    route: ROUTE,
    model: DEEPSEEK_MODEL,
    estimatedTokens,
  });

  if (!gate.allowed) {
    console.error('[DRIFT_SHIELD_BLOCKED]', {
      reason: gate.reason,
      userId: userId || 'anonymous',
    });
    return '';
  }

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: DEEPSEEK_MODEL,
        messages,
        thinking: { type: 'disabled' },
        temperature: 0.15,
        max_tokens: 900,
        stream: false,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 70000,
      }
    );

    const usage = response?.data?.usage || {};
    const choice = response?.data?.choices?.[0];

    recordAIUsage({
      userId: userId || 'anonymous',
      route: ROUTE,
      model: DEEPSEEK_MODEL,
      payloadChars,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      success: true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    });

    return choice?.message?.content || choice?.text || '';
  } catch (error) {
    const status = error.response?.status || 0;
    const data = error.response?.data;
    const errorCode = data?.error?.code || data?.error?.type || 'unknown_error';

    console.error('[DRIFT_SHIELD_FAILED]', {
      status,
      data,
      message: error.message,
    });

    recordAIUsage({
      userId: userId || 'anonymous',
      route: ROUTE,
      model: DEEPSEEK_MODEL,
      payloadChars,
      success: false,
      status,
      errorCode,
      latencyMs: Date.now() - startedAt,
    });

    return '';
  }
}

async function shieldBottle({ userId, title, content }) {
  const rawTitle = clampText(title, MAX_TITLE_CHARS);
  const rawContent = clampText(content, MAX_CONTENT_CHARS);

  if (!rawTitle && !rawContent) {
    return fallbackShield({ title, content, reason: 'empty' });
  }

  const aiText = await callDeepSeekShield({
    userId,
    title: rawTitle,
    content: rawContent,
  });

  const parsed = extractJsonObject(aiText);
  if (!parsed) {
    return fallbackShield({
      title: rawTitle,
      content: rawContent,
      reason: 'ai_parse_failed',
    });
  }

  const safeTitle = clampText(parsed.title || rawTitle, MAX_TITLE_CHARS) || '一只漂流瓶';
  const safeContent = clampText(parsed.content || rawContent, MAX_CONTENT_CHARS);

  const profanityRatio = clampNumber(parsed.profanityRatio, 0, 1, 0);
  const oceanPenalty = Number.isFinite(Number(parsed.oceanPenalty))
    ? Math.max(-9, Math.min(0, Math.trunc(Number(parsed.oceanPenalty))))
    : calcPenaltyFromRatio(profanityRatio);

  return {
    title: safeTitle,
    content: safeContent,
    anonymousChanged: Boolean(parsed.anonymousChanged),
    profanityRatio,
    oceanPenalty,
    exposureWeight: exposureWeightFromPenalty(oceanPenalty),
    shieldVersion: SHIELD_VERSION,
    fallback: false,
    fallbackReason: '',
  };
}

module.exports = {
  shieldBottle,
  calcPenaltyFromRatio,
  exposureWeightFromPenalty,
  SHIELD_VERSION,
};
