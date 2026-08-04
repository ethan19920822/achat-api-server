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
      return APP_MAP;
  }
}

function buildGuardianPrompt({
  message,
  basePrompt,
  memoryProfile = {},
}) {
  const topic = detectGuardianTopic(
    message,
    memoryProfile.guardianClientTopic,
  );

  const sections = [
    CORE_IDENTITY,
    safeText(basePrompt),
    PRODUCT_REPLY_RULES,
    topicKnowledge(topic),
  ].filter(Boolean);

  return {
    topic,
    prompt: sections.join('\n\n'),
  };
}

module.exports = {
  buildGuardianPrompt,
};
