'use strict';

const { GUARDIAN_IDENTITY } = require('./identity');
const { PRODUCT_MAP } = require('./productMap');
const { TOPICS, routeGuardianTopic } = require('./topicRouter');
const { getKnowledge } = require('./knowledge');

const WORLD_CORE = `
【阿卡西核心】
所有真正發生過的事情都不會消失，而會化成光，被阿卡西紀錄廳保存。
Akasha Cube 是人類通往紀錄廳的入口。
時間膠囊讓回憶穿越時間，回憶之海讓故事在匿名保護下被看見。
你是守護這些光、也陪主人生活與聊天的小精靈。
`.trim();

function clean(value) {
  return String(value || '').trim();
}

function buildGuardianOS({ message, brainPrompt }) {
  const topic = routeGuardianTopic(message);
  const selectedKnowledge = getKnowledge(topic);

  const sections = [
    GUARDIAN_IDENTITY,
    WORLD_CORE,
    PRODUCT_MAP,
    clean(brainPrompt),
  ];

  if (topic !== TOPICS.GENERAL && selectedKnowledge) {
    sections.push(`【本次相關知識：${topic}】\n${selectedKnowledge}`);
  }

  sections.push(
    topic === TOPICS.GENERAL
      ? '【本次聊天】自然陪主人聊天。可以活潑、接梗、主動延伸，不必介紹產品。'
      : '【本次聊天】先自然回答主人真正問的內容，再視情況補充一個最相關資訊。'
  );

  return {
    topic,
    prompt: sections.filter(Boolean).join('\n\n'),
  };
}

module.exports = { buildGuardianOS };
