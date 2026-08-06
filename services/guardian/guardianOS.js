'use strict';

const { GUARDIAN_IDENTITY } = require('./identity');
const { AKASHA_WORLD } = require('./world');
const { PRODUCT_MAP } = require('./productMap');
const { TOPICS, routeGuardianTopic } = require('./topicRouter');

function buildGuardianOS({ message, brainPrompt }) {
  const topic = routeGuardianTopic(message);
  const sections = [GUARDIAN_IDENTITY];

  if (topic === TOPICS.WORLD || topic === TOPICS.GUARDIAN) {
    sections.push(AKASHA_WORLD);
  }

  if (topic !== TOPICS.GENERAL) {
    sections.push(PRODUCT_MAP);
  }

  if (String(brainPrompt || '').trim()) {
    sections.push(String(brainPrompt).trim());
  }

  sections.push(
    topic === TOPICS.GENERAL
      ? '【本輪】自然聊天。保持活潑、有反應、可主動延伸，不必介紹產品或世界觀。'
      : `【本輪主題：${topic}】先自然回答主人真正問的內容，再補一個最相關資訊。`
  );

  return { topic, prompt: sections.filter(Boolean).join('\n\n') };
}

module.exports = { buildGuardianOS };
