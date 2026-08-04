'use strict';

const { GUARDIAN_IDENTITY } = require('./identity');
const { PRODUCT_MAP } = require('./productMap');
const { TOPICS, routeGuardianTopic } = require('./topicRouter');
const { getKnowledge } = require('./knowledge');

const PRODUCT_RULES = `
【PRODUCT GROUNDING】
回答產品問題時，只能使用 Akasha Cube 已提供的產品知識。
不要用網路上同名名詞、動畫、宗教或其他 App 的內容代替。
不知道目前是否已上線的功能時，直接說明不確定，不要自己補完。
先回答主人正在問的功能，再補一個最相關的下一步。
`.trim();

function clean(value) {
  return String(value || '').trim();
}

function buildGuardianOS({
  message,
  brainPrompt,
}) {
  const topic = routeGuardianTopic(message);
  const selectedKnowledge = getKnowledge(topic);

  const sections = [
    GUARDIAN_IDENTITY,
    PRODUCT_MAP,
    PRODUCT_RULES,
    clean(brainPrompt),
  ];

  if (topic !== TOPICS.GENERAL && selectedKnowledge) {
    sections.push(`【CURRENT TOPIC：${topic}】\n${selectedKnowledge}`);
  }

  sections.push(
    topic === TOPICS.GENERAL
      ? '【CURRENT MODE】一般陪伴聊天。不要主動介紹產品或世界觀。'
      : `【CURRENT MODE】主人正在詢問 Akasha Cube 的 ${topic}。請以本次載入的產品知識回答。`
  );

  return {
    topic,
    prompt: sections.filter(Boolean).join('\n\n'),
  };
}

module.exports = {
  buildGuardianOS,
};
