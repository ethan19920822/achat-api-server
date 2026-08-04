'use strict';

const {
  TOPICS,
  detectGuardianTopic,
} = require('./guardianTopics');

const {
  CORE_IDENTITY,
  PRODUCT_REPLY_RULES,
  APP_MAP,
  WORLD,
  GUARDIAN,
  CAPSULE,
  PALACE,
  DRIFT_BOTTLE,
  PEOPLE,
  IMPORTANT_DATES,
  MEMBERSHIP,
  VOICE,
  PROFILE,
  NOTIFICATIONS,
  CONTACT_SUPPORT,
} = require('./guardianCodex');

const TAIWAN_STYLE_LOCK = `
【語言與風格鎖】
使用自然繁體中文與台灣日常用語。
不要使用中國大陸網路腔、廣告腔、短影音文案或狗血散文。
禁止使用：咱們、咋、絕絕子。

`.trim();

function safeText(value) {
  return String(value || '').trim();
}

function topicKnowledge(topic) {
  switch (topic) {
    case TOPICS.WORLD:
      return `${WORLD}\n\n${APP_MAP}`;
    case TOPICS.GUARDIAN:
      return `${WORLD}\n\n${GUARDIAN}`;
    case TOPICS.CAPSULE:
      return `${CAPSULE}\n\n${PEOPLE}\n\n${IMPORTANT_DATES}`;
    case TOPICS.PALACE:
      return `${PALACE}\n\n${PEOPLE}\n\n${IMPORTANT_DATES}`;
    case TOPICS.DRIFT_BOTTLE:
      return `${DRIFT_BOTTLE}\n\n${NOTIFICATIONS}`;
    case TOPICS.PEOPLE:
      return `${PEOPLE}\n\n${CAPSULE}`;
    case TOPICS.IMPORTANT_DATES:
      return `${IMPORTANT_DATES}\n\n${CAPSULE}`;
    case TOPICS.MEMBERSHIP:
      return MEMBERSHIP;
    case TOPICS.VOICE:
      return VOICE;
    case TOPICS.PROFILE:
      return PROFILE;
    case TOPICS.NOTIFICATIONS:
      return NOTIFICATIONS;
    case TOPICS.CONTACT_SUPPORT:
      return CONTACT_SUPPORT;
    case TOPICS.GENERAL:
    default:
      // 一般聊天只給最短地圖，不塞完整世界觀。
      return APP_MAP;
  }
}

function resolveTopic(message, clientTopic) {
  const normalizedClientTopic = safeText(clientTopic);

  // Flutter 傳來 general 時，不能蓋掉伺服器對真正訊息的判斷。
  if (
    normalizedClientTopic &&
    normalizedClientTopic !== TOPICS.GENERAL
  ) {
    return detectGuardianTopic(message, normalizedClientTopic);
  }

  return detectGuardianTopic(message);
}

function buildGuardianPrompt({
  message,
  basePrompt,
  memoryProfile = {},
}) {
  const topic = resolveTopic(
    message,
    memoryProfile.guardianClientTopic,
  );

  const sections = [
    CORE_IDENTITY,
    PRODUCT_REPLY_RULES,
    TAIWAN_STYLE_LOCK,
    safeText(basePrompt),
    topicKnowledge(topic),
    // 最後再鎖一次，避免模型被世界觀段落帶去寫散文。
    TAIWAN_STYLE_LOCK,
  ].filter(Boolean);

  return {
    topic,
    prompt: sections.join('\n\n'),
  };
}

module.exports = {
  buildGuardianPrompt,
};
