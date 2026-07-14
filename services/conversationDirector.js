'use strict';

function scoreNeed({ context, situation }) {
  const text = `${context.lastUserMessage} ${situation.emotion}`;
  const scores = {
    companionship: 35,
    play: 20,
    analysis: 20,
    celebration: 5,
    safety: 0,
    storytelling: 10,
    practicalHelp: 15,
    quietListening: 15,
  };

  if (/難過|哭|委屈|失戀|劈腿|背叛|孤單/.test(text)) {
    scores.companionship += 50;
    scores.quietListening += 35;
    scores.safety += 20;
    scores.play -= 15;
  }
  if (/害怕|危險|喝酒|醉|半夜|凌晨|一個人|想放棄/.test(text)) {
    scores.safety += 65;
    scores.companionship += 20;
  }
  if (/哈哈|🤣|😂|開玩笑|鬧/.test(text) || context.runningTone === 'playful') {
    scores.play += 60;
    scores.companionship += 10;
  }
  if (/怎麼辦|怎麼做|幫我|分析|建議|創業|工作|程式|企劃/.test(text)) {
    scores.analysis += 45;
    scores.practicalHelp += 50;
  }
  if (/成功|撿到錢|開心|太好了|幸運/.test(text)) {
    scores.celebration += 70;
    scores.play += 25;
  }
  if (/故事|以前|後來|有一次|鬼故事/.test(text)) {
    scores.storytelling += 60;
  }

  for (const key of Object.keys(scores)) {
    scores[key] = Math.max(0, Math.min(100, scores[key]));
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return {
    scores,
    primary: sorted[0][0],
    secondary: sorted[1][0],
    confidence: Math.min(96, Math.max(35, sorted[0][1] - sorted[1][1] + 55)),
  };
}

module.exports = {
  scoreNeed,
};
