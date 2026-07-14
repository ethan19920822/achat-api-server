'use strict';

const MAX_RECENT_RAW = 15;
const MAX_CONTEXT_SOURCE = 30;
const MAX_MESSAGE_CHARS = 300;

function safeText(value) {
  return String(value || '').trim();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((item) => {
      const role = item?.role === 'assistant' ? 'assistant' : 'user';
      const content = safeText(item?.content || item?.text).slice(0, MAX_MESSAGE_CHARS);
      const createdAt = parseDate(item?.createdAt || item?.createdAtLocal);
      return { role, content, createdAt };
    })
    .filter((item) => item.content)
    .slice(-MAX_CONTEXT_SOURCE);
}

function calculateReplyPace(messages) {
  const gaps = [];
  for (let i = 1; i < messages.length; i += 1) {
    const prev = messages[i - 1];
    const current = messages[i];
    if (!prev.createdAt || !current.createdAt) continue;
    if (prev.role === current.role) continue;
    const gapSec = Math.max(0, Math.round((current.createdAt - prev.createdAt) / 1000));
    if (gapSec <= 3600) gaps.push(gapSec);
  }

  if (!gaps.length) return { label: 'unknown', averageSeconds: null };
  const averageSeconds = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  let label = 'steady';
  if (averageSeconds <= 25) label = 'very_fast';
  else if (averageSeconds <= 90) label = 'fast';
  else if (averageSeconds >= 600) label = 'slow';

  return { label, averageSeconds };
}

function summarizeOlderMessages(messages) {
  const older = messages.slice(0, Math.max(0, messages.length - MAX_RECENT_RAW));
  if (!older.length) return '';

  const compact = older.slice(-10).map((item) => {
    const speaker = item.role === 'assistant' ? 'Momo' : '主人';
    return `${speaker}：${item.content.slice(0, 72)}`;
  });

  return compact.join('\n');
}

function detectRunningTone(messages) {
  const text = messages.map((m) => m.content).join(' ');
  const scores = {
    playful: (text.match(/哈|哈哈|🤣|😂|欸|嘿|鬧|玩笑/g) || []).length,
    sad: (text.match(/難過|哭|委屈|失落|失戀|劈腿|孤單|不開心/g) || []).length,
    angry: (text.match(/生氣|火大|不爽|討厭|吵架|氣死/g) || []).length,
    work: (text.match(/工作|老闆|同事|需求|開會|企劃|創業|公司/g) || []).length,
    story: (text.match(/故事|以前|後來|那時候|有一次|記得/g) || []).length,
  };

  const [tone, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return score > 0 ? tone : 'casual';
}

function buildContextSnapshot({ recentMessages = [], now = new Date() } = {}) {
  const messages = normalizeMessages(recentMessages);
  const recentRaw = messages.slice(-MAX_RECENT_RAW);
  const olderSummary = summarizeOlderMessages(messages);
  const replyPace = calculateReplyPace(messages);
  const last = messages[messages.length - 1];
  const lastGapMinutes = last?.createdAt
    ? Math.max(0, Math.round((now - last.createdAt) / 60000))
    : null;

  return {
    messages,
    recentRaw,
    olderSummary,
    replyPace,
    lastGapMinutes,
    runningTone: detectRunningTone(recentRaw),
    lastUserMessage: [...messages].reverse().find((m) => m.role === 'user')?.content || '',
  };
}

module.exports = {
  buildContextSnapshot,
  normalizeMessages,
};
