// services/voiceCandidateService.js
// Akasha Whisper v1.0
// This file only evaluates whether the current conversation is interesting
// enough to become a Whisper candidate. It does not call ElevenLabs and does
// not write Firestore.

const HIGH_WORDS = [
  '哈哈', '笑死', '太扯', '酷', '帥', '可愛', '荒謬', '真的假的',
  '秘密', '原來', '居然', '沒想到', '第一次', '終於', '成功',
  '喜歡', '愛', '分手', '和好', '生氣', '委屈', '害怕', '難過',
  '興奮', '期待', '旅行', '咖啡', '約會', '工作', '主管', '朋友',
  '家人', '媽媽', '爸爸', '前任', '夢', '未來', '故事',
];

const LOW_VALUE_PATTERNS = [
  /^早安[。！!]?$/,
  /^晚安[。！!]?$/,
  /^謝謝[。！!]?$/,
  /^好[。！!]?$/,
  /^嗯+[。！!]?$/,
  /^哈哈+[。！!]?$/,
  /^在嗎[？?]?$/,
  /^吃了嗎[？?]?$/,
];

const UNSAFE_WORDS = [
  '自殺', '輕生', '不想活', '去死', '殺人', '傷害自己',
];

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countRecentUserMessages(recentMessages = []) {
  return recentMessages.filter((item) => item?.role === 'user').length;
}

function hasSubstance(text) {
  if (text.length >= 20) return true;
  return HIGH_WORDS.some((word) => text.includes(word));
}

function evaluateVoiceCandidate({
  message,
  reply,
  recentMessages = [],
} = {}) {
  const userText = clean(message);
  const assistantText = clean(reply);

  if (!userText || !assistantText) {
    return {
      candidate: false,
      score: 0,
      reason: 'empty',
      category: 'none',
      unsafe: false,
    };
  }

  const unsafe = UNSAFE_WORDS.some(
    (word) => userText.includes(word) || assistantText.includes(word),
  );

  // Crisis and high-risk content stays text-only in v1.
  if (unsafe) {
    return {
      candidate: false,
      score: 0,
      reason: 'safety_block',
      category: 'safety',
      unsafe: true,
    };
  }

  if (LOW_VALUE_PATTERNS.some((pattern) => pattern.test(userText))) {
    return {
      candidate: false,
      score: 10,
      reason: 'low_value_greeting',
      category: 'ordinary',
      unsafe: false,
    };
  }

  let score = 0;
  const reasons = [];

  if (userText.length >= 12) {
    score += 14;
    reasons.push('user_has_context');
  }

  if (userText.length >= 30) {
    score += 12;
    reasons.push('user_story_depth');
  }

  if (assistantText.length >= 20) {
    score += 10;
    reasons.push('reply_has_substance');
  }

  const matchedWords = HIGH_WORDS.filter(
    (word) => userText.includes(word) || assistantText.includes(word),
  );

  if (matchedWords.length > 0) {
    score += Math.min(28, matchedWords.length * 7);
    reasons.push(`matched:${matchedWords.slice(0, 4).join(',')}`);
  }

  const recentUserCount = countRecentUserMessages(recentMessages);
  if (recentUserCount >= 2) {
    score += 12;
    reasons.push('conversation_in_progress');
  }

  if (recentUserCount >= 5) {
    score += 8;
    reasons.push('conversation_momentum');
  }

  if (
    /[😂🤣😆😏🤭✨🔥]/u.test(userText) ||
    /[😂🤣😆😏🤭✨🔥]/u.test(assistantText)
  ) {
    score += 10;
    reasons.push('playful_energy');
  }

  if (
    /我覺得|我以為|我發現|其實|後來|結果|因為|但是|原來/.test(userText)
  ) {
    score += 12;
    reasons.push('personal_reflection');
  }

  if (!hasSubstance(userText)) {
    score -= 14;
    reasons.push('thin_message');
  }

  const category =
    /哈哈|笑死|酷|帥|可愛|太扯|荒謬/.test(`${userText} ${assistantText}`)
      ? 'playful'
      : /難過|委屈|害怕|生氣|分手|和好/.test(
            `${userText} ${assistantText}`,
          )
        ? 'feeling'
        : /第一次|終於|成功|旅行|約會|夢|未來|故事/.test(
              `${userText} ${assistantText}`,
            )
          ? 'story'
          : 'conversation';

  const finalScore = Math.max(0, Math.min(100, score));

  return {
    candidate: finalScore >= 70,
    score: finalScore,
    reason: reasons.join('|') || 'not_enough_signal',
    category,
    unsafe: false,
  };
}

function buildVoiceLine({ message, reply, phase = 'first' } = {}) {
  const userText = clean(message);
  const assistantText = clean(reply);

  // Keep v1 short enough for roughly 7–12 seconds.
  const source = assistantText || userText;
  const pieces = source
    .split(/(?<=[。！？!?])|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);

  let line =
    pieces.find((item) => item.length >= 16 && item.length <= 75) ||
    pieces[0] ||
    source;

  line = line
    .replace(/^(Momo|Akasha)[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (line.length > 86) {
    line = `${line.slice(0, 84)}。`;
  }

  if (phase === 'follow_up' && line.length < 18) {
    line = `我剛剛又想到一件事。${line}`;
  }

  return line;
}

module.exports = {
  evaluateVoiceCandidate,
  buildVoiceLine,
};
