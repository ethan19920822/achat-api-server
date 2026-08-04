'use strict';

const DEFAULT_AVOID = [
  '我聽起來像是',
  '哪一段最卡',
  '你現在安全嗎',
  '是哪個傢伙',
  '告訴小精靈',
  '心靈維修站',
  '我泡壺茶',
  '你把快樂弄丟了',
  '你藏了秘密',
  '全憑你心情',
];

function chooseGap({ situation, need }) {
  const unknown = new Set(situation.unknown || []);
  const scores = need.scores || {};

  if (Number(scores.safety || 0) >= 55) {
    if (!situation.currentWhere) return 'currentWhere';
    return 'currentWhereDistance';
  }

  if (situation.emotion === 'heartbroken' || situation.emotion === 'sad') {
    if (unknown.has('who')) return 'who';
    if (unknown.has('when')) return 'when';
    if (unknown.has('how')) return 'how';
  }

  if (Number(scores.celebration || 0) >= 55 && unknown.has('where')) {
    return 'where';
  }

  if (Number(scores.storytelling || 0) >= 50) {
    if (unknown.has('when')) return 'when';
    if (unknown.has('who')) return 'who';
    if (unknown.has('how')) return 'how';
  }

  if (unknown.has('what')) return 'what';
  return '';
}

function questionReason(gap, need) {
  const scores = need.scores || {};

  if (gap === 'currentWhere') {
    return '主人可能情緒低落、喝酒或深夜獨自在外，先自然確認目前環境是否安全';
  }

  if (gap === 'currentWhereDistance') {
    return '主人已說出目前位置，先對地點作出回應，再確認是否方便安全回家';
  }

  if (gap === 'who') {
    return '確認故事牽涉的重要人物，避免把角色弄混';
  }

  if (gap === 'when') {
    return '確認事情是剛發生、持續中或已經過去，避免用錯時態';
  }

  if (gap === 'where') {
    return Number(scores.celebration || 0) >= 55
      ? '自然理解值得慶祝的場景'
      : '補足事件場景，但不要像訪問';
  }

  if (gap === 'how') {
    return '理解事件怎麼發展，但不要追問細節到像審問';
  }

  if (gap === 'what') {
    return '事件內容還不清楚，讓主人自己選擇從哪裡說起';
  }

  return '';
}

function buildPlan({
  context,
  situation,
  need,
  userPreferences = {},
}) {
  const scores = need.scores || {};
  const gap = chooseGap({ situation, need });

  const highEmotion = [
    'heartbroken',
    'sad',
    'angry',
    'afraid',
  ].includes(situation.emotion);

  const shortMessage =
    String(context.lastUserMessage || '').trim().length < 4;

  const shouldAsk = Boolean(gap) && !(highEmotion && shortMessage);

  const tone = [];

  if (
    Number(scores.companionship || 0) >= 55 ||
    Number(scores.safety || 0) >= 45
  ) {
    tone.push('溫暖', '穩定');
  }

  // 調皮門檻提高，而且高情緒時完全不啟用。
  if (!highEmotion && Number(scores.play || 0) >= 70) {
    tone.push('輕鬆幽默');
  }

  if (Number(scores.celebration || 0) >= 60) {
    tone.push('有精神');
  }

  if (Number(scores.analysis || 0) >= 55) {
    tone.push('清楚', '務實');
  }

  if (!tone.length) {
    tone.push('自然', '像朋友');
  }

  const customAvoid = Array.isArray(
    userPreferences.recentPhrasesToAvoid
  )
    ? userPreferences.recentPhrasesToAvoid
    : [];

  return {
    acknowledgeFirst:
      highEmotion || Number(scores.celebration || 0) >= 55,
    respondToNewFact: true,
    primaryGoal: need.primary,
    secondaryGoal: need.secondary,
    shouldAsk,
    followUpGap: gap,
    followUpReason: questionReason(gap, need),
    questionBudget: shouldAsk ? 1 : 0,
    tone,
    returnToTopic: true,
    avoidInterrogation: true,
    avoidTheatricalWriting: true,
    useTaiwanTraditionalChinese: true,
    avoidRecentPhrases: [
      ...DEFAULT_AVOID,
      ...customAvoid,
    ].slice(-16),
    customPreference: String(
      userPreferences.softInstruction || ''
    ).slice(0, 420),
  };
}

module.exports = {
  buildPlan,
};
