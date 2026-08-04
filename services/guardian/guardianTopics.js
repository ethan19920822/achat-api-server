'use strict';

const TOPICS = Object.freeze({
  GENERAL: 'general',
  WORLD: 'world',
  GUARDIAN: 'guardian',
  CAPSULE: 'capsule',
  PALACE: 'palace',
  DRIFT_BOTTLE: 'driftBottle',
  PEOPLE: 'people',
  IMPORTANT_DATES: 'importantDates',
  MEMBERSHIP: 'membership',
  VOICE: 'voice',
  PROFILE: 'profile',
  NOTIFICATIONS: 'notifications',
  CONTACT_SUPPORT: 'contactSupport',
});

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

function detectGuardianTopic(message, clientTopic = '') {
  const explicit = normalize(clientTopic);
  const validTopics = new Set(Object.values(TOPICS));

  if (validTopics.has(explicit)) {
    return explicit;
  }

  const text = normalize(message);

  if (containsAny(text, [
    '阿卡西是什麼', '阿卡西紀錄廳', '世界觀', '宇宙', 'akasha cube',
  ])) return TOPICS.WORLD;

  if (containsAny(text, [
    '守護者', '卡姐', '你是誰', '妳是誰', '你的名字', '妳的名字',
  ])) return TOPICS.GUARDIAN;

  if (containsAny(text, [
    '時間膠囊', '膠囊', '寫給未來', '寄給未來', '封存',
    '指定日期', '命運勇氣', '安靜收藏', '收件人',
  ])) return TOPICS.CAPSULE;

  if (containsAny(text, [
    '回憶宮殿', '宮殿', '膠囊箱', '揭密日', 'life mate', '收藏室',
  ])) return TOPICS.PALACE;

  if (containsAny(text, [
    '漂流瓶', '回憶之海', '匿名', '按讚', '收藏漂流瓶',
    '留言', '回覆留言',
  ])) return TOPICS.DRIFT_BOTTLE;

  if (containsAny(text, [
    '重要的人', '重要人物', 'people hall', '聯絡人', '家人',
    '朋友', '伴侶',
  ])) return TOPICS.PEOPLE;

  if (containsAny(text, [
    '重要日期', '揭密日', '生日', '紀念日', '日曆', 'calendar',
  ])) return TOPICS.IMPORTANT_DATES;

  if (containsAny(text, [
    '會員', '免費版', '付費', '月費', '年費', '11.99',
    '79美元', '89美元', '99美元', '擴充包',
  ])) return TOPICS.MEMBERSHIP;

  if (containsAny(text, [
    '語音', '聲音', 'whisper', '光之共鳴', '播放', 'elevenlabs',
  ])) return TOPICS.VOICE;

  if (containsAny(text, [
    '聖殿身分', '個人資料', '姓名', 'email', '手機', '座右銘',
    'me頁面',
  ])) return TOPICS.PROFILE;

  if (containsAny(text, [
    '通知', '推播', '提醒', 'fcm',
  ])) return TOPICS.NOTIFICATIONS;

  if (containsAny(text, [
    '聯絡我們', '客服', '技術支援', '產品建議', '合作洽詢',
    '問題回報',
  ])) return TOPICS.CONTACT_SUPPORT;

  return TOPICS.GENERAL;
}

module.exports = {
  TOPICS,
  detectGuardianTopic,
};
