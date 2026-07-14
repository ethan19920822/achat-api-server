'use strict';

function safeText(value) {
  return String(value || '').trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return safeText(match[1]).slice(0, 50);
  }
  return '';
}

function detectEmotion(text) {
  const groups = [
    ['heartbroken', ['劈腿', '失戀', '背叛', '被甩']],
    ['sad', ['難過', '想哭', '哭了', '委屈', '失落', '不開心']],
    ['angry', ['生氣', '火大', '不爽', '氣死', '吵架']],
    ['afraid', ['害怕', '怕', '恐慌', '危險']],
    ['tired', ['累', '沒睡', '失眠', '撐不住']],
    ['happy', ['開心', '爽', '太好了', '幸運', '撿到錢', '成功']],
    ['playful', ['哈哈', '🤣', '😂', '鬧你', '開玩笑']],
  ];

  for (const [label, keywords] of groups) {
    if (keywords.some((word) => text.includes(word))) return label;
  }
  return '';
}

function detectWho(text, knownPeople = []) {
  for (const person of knownPeople) {
    if (person && text.includes(person)) return person;
  }

  return firstMatch(text, [
    /(?:跟|被|是|那個)([\u4e00-\u9fa5A-Za-z0-9_]{1,12})(?:吵架|劈腿|欺負|說|害|弄哭)/,
    /([\u4e00-\u9fa5A-Za-z0-9_]{1,12})(?:又)?跟我/,
  ]);
}

function detectWhen(text) {
  return firstMatch(text, [
    /(今天(?:早上|下午|晚上|凌晨)?)/,
    /(昨天(?:早上|下午|晚上|凌晨)?)/,
    /(前天(?:早上|下午|晚上|凌晨)?)/,
    /(剛剛|剛才|昨晚|半夜|凌晨\s*\d{1,2}(?::\d{2})?)/,
    /(上週|上個月|去年|幾年前)/,
  ]);
}

function cleanPlace(value) {
  return safeText(value)
    .replace(/(?:喝酒|散步|走走|吹風|哭|待著|聊天|坐著|發呆).*$/, '')
    .replace(/(?:了|呢|啊|呀)$/, '')
    .trim()
    .slice(0, 30);
}

function detectCurrentLocation(text) {
  return cleanPlace(firstMatch(text, [
    /(?:我現在|現在我|我還|我已經|我正在)在([^，。！？\n]{1,20})/,
    /我在([^，。！？\n]{1,20})/,
  ]));
}

function detectEventLocation(text) {
  return firstMatch(text, [
    /(?:事情|這件事|吵架|發生|碰到|看到).*?在([^，。！？\n]{1,20})/,
    /在([^，。！？\n]{1,20})(?:吵架|發生|被|遇到)/,
  ]);
}

function inferWhat(text) {
  const clean = safeText(text);
  if (!clean) return '';
  if (clean.length <= 120) return clean;
  return `${clean.slice(0, 117)}...`;
}

function mergeValue(oldValue, newValue) {
  return safeText(newValue) || safeText(oldValue);
}

function buildSituation({ context, memoryProfile = {}, savedSituation = {} }) {
  const savedUpdatedAt = savedSituation.updatedAtLocal
    ? new Date(savedSituation.updatedAtLocal)
    : null;
  const savedIsFresh = savedUpdatedAt &&
    !Number.isNaN(savedUpdatedAt.getTime()) &&
    Date.now() - savedUpdatedAt.getTime() <= 48 * 60 * 60 * 1000;
  const baseSituation = savedIsFresh ? savedSituation : {};

  const userText = context.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  const latest = context.lastUserMessage || '';
  const knownPeople = Array.isArray(memoryProfile.importantPeople)
    ? memoryProfile.importantPeople.slice(0, 12)
    : [];

  const extracted = {
    who: detectWho(userText, knownPeople),
    what: inferWhat(latest),
    when: detectWhen(userText),
    currentWhere: detectCurrentLocation(latest) || detectCurrentLocation(userText),
    eventWhere: detectEventLocation(userText),
    emotion: detectEmotion(userText),
    why: firstMatch(userText, [/(?:因為|原因是|是因為)([^，。！？\n]{2,80})/]),
    how: firstMatch(userText, [/(?:後來|結果|然後)([^。！？\n]{2,100})/]),
  };

  const merged = {
    who: mergeValue(baseSituation.who, extracted.who),
    what: mergeValue(baseSituation.what, extracted.what),
    when: mergeValue(baseSituation.when, extracted.when),
    currentWhere: mergeValue(baseSituation.currentWhere, extracted.currentWhere),
    eventWhere: mergeValue(baseSituation.eventWhere, extracted.eventWhere),
    emotion: mergeValue(baseSituation.emotion, extracted.emotion),
    why: mergeValue(baseSituation.why, extracted.why),
    how: mergeValue(baseSituation.how, extracted.how),
  };

  const unknown = [];
  if (!merged.who) unknown.push('who');
  if (!merged.when) unknown.push('when');
  if (!merged.currentWhere && !merged.eventWhere) unknown.push('where');
  if (!merged.what) unknown.push('what');
  if (!merged.how) unknown.push('how');
  if (!merged.why) unknown.push('why');

  return {
    ...merged,
    unknown,
    updatedAtLocal: new Date().toISOString(),
  };
}

module.exports = {
  buildSituation,
};
