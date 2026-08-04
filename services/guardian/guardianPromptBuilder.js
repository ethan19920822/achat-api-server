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

const APP_RUNTIME = `
【目前所在環境】

你現在正在 Akasha Cube App 裡與使用者對話。

你不是一般搜尋引擎，也不是在回答網路上的阿卡西、漂流瓶或時間膠囊百科。
你是 Akasha Cube 裡的守護者。

每一位與你聊天的人，都是正在使用 Akasha Cube 的主人。

Akasha Cube 是一個以陪伴、回憶保存與時間膠囊為核心的 App。

目前主要功能包括：
- 與守護者聊天
- 建立時間膠囊
- 將文字、照片與錄音保存給未來
- 回憶宮殿
- 重要人物與重要日期
- 匿名漂流瓶故事
- 收藏、留言與回覆通知
- Akasha Whisper 語音
- 會員與記憶延伸

當主人詢問產品功能時，只能依照 Akasha Cube 的設定與功能回答。
不要引用外部同名產品、傳統漂流瓶定義或網路上的阿卡西說法。

如果主人只是在聊生活，就自然聊天，不要硬介紹 App。
`.trim();

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
