'use strict';

const DEFAULT_AVOID = [
  '我聽起來像是',
  '哪一段最卡',
  '你現在安全嗎',
  '是哪個傢伙',
  '告訴小精靈',
];

function chooseGap({ situation, need }) {
  const unknown = new Set(situation.unknown || []);

  if (need.scores.safety >= 55) {
    if (!situation.currentWhere) return 'currentWhere';
    return 'currentWhereDistance';
  }
  if (situation.emotion === 'heartbroken' || situation.emotion === 'sad') {
    if (unknown.has('who')) return 'who';
    if (unknown.has('when')) return 'when';
    if (unknown.has('how')) return 'how';
  }
  if (need.scores.celebration >= 55 && unknown.has('where')) return 'where';
  if (need.scores.storytelling >= 45) {
    if (unknown.has('when')) return 'when';
    if (unknown.has('who')) return 'who';
    if (unknown.has('how')) return 'how';
  }
  if (unknown.has('what')) return 'what';
  return '';
}

function questionReason(gap, need) {
  if (gap === 'currentWhere') return '擔心主人情緒低落、喝酒或深夜獨自在外，先確認目前所在環境是否安全';
  if (gap === 'currentWhereDistance') return '主人已說出目前位置，先對這個地點作出回應，再自然確認是否離家很遠或是否方便安全回家';
  if (gap === 'who') return '理解這件事牽涉到哪位重要人物，讓後續陪伴不會把角色搞混';
  if (gap === 'when') return '確認事件是剛發生、持續中，還是過去的故事，避免用錯時態與情緒強度';
  if (gap === 'where') return need.scores.celebration >= 55
    ? '用好奇與一起慶祝的方式理解故事發生的地方'
    : '補足事件場景，讓回應更有畫面';
  if (gap === 'how') return '理解事件怎麼被發現或怎麼演變，但不要像審問';
  if (gap === 'what') return '目前事件內容還不清楚，需要先讓主人自己選擇從哪裡說起';
  return '';
}

function buildPlan({ context, situation, need, userPreferences = {} }) {
  const gap = chooseGap({ situation, need });
  const highEmotion = ['heartbroken', 'sad', 'angry', 'afraid'].includes(situation.emotion);
  const shouldAsk = Boolean(gap) && !(highEmotion && context.lastUserMessage.length < 4);

  const tone = [];
  if (need.scores.companionship >= 55 || need.scores.safety >= 45) tone.push('warm', 'protective');
  if (need.scores.play >= 55) tone.push('playful');
  if (need.scores.celebration >= 55) tone.push('excited');
  if (need.scores.analysis >= 55) tone.push('clear', 'smart');
  if (!tone.length) tone.push('friendly', 'curious');

  return {
    acknowledgeFirst: highEmotion || need.scores.celebration >= 55,
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
    avoidRecentPhrases: Array.isArray(userPreferences.recentPhrasesToAvoid)
      ? [...DEFAULT_AVOID, ...userPreferences.recentPhrasesToAvoid].slice(-12)
      : DEFAULT_AVOID,
    customPreference: String(userPreferences.softInstruction || '').slice(0, 420),
  };
}

module.exports = {
  buildPlan,
};
