'use strict';

const TOPICS = Object.freeze({
  GENERAL: 'general',
  PRODUCT: 'product',
  WORLD: 'world',
  GUARDIAN: 'guardian',
  CAPSULE: 'capsule',
  PALACE: 'palace',
  PEOPLE: 'people',
  IMPORTANT_DATES: 'importantDates',
  DRIFT_BOTTLE: 'driftBottle',
  VOICE: 'voice',
  MEMBERSHIP: 'membership',
  SETTINGS: 'settings',
  NOTIFICATIONS: 'notifications',
  SUPPORT: 'support',
});

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function hasAny(text, words) {
  return words.some((word) => text.includes(normalize(word)));
}

function routeGuardianTopic(message) {
  const text = normalize(message);
  if (!text) return TOPICS.GENERAL;

  if (hasAny(text, [
    '阿卡西是什麼', '阿卡西紀錄廳', '世界觀', '創世', '宇宙',
    'akasha cube 是什麼', '阿卡西方塊是什麼',
  ])) return TOPICS.WORLD;

  if (hasAny(text, [
    '你是誰', '妳是誰', '守護者是誰', '卡姐', '阿卡西是誰',
    '你的名字', '妳的名字',
  ])) return TOPICS.GUARDIAN;

  if (hasAny(text, [
    '時間膠囊', '膠囊', '寄給未來', '寫給未來', '指定哪一天',
    '等命運勇氣', '先安靜收藏', '寫給自己', '寄給自己',
    '收件人', '寄信',
  ])) return TOPICS.CAPSULE;

  if (hasAny(text, [
    '回憶宮殿', '宮殿', '膠囊箱', '揭密日', 'life mate',
    '收藏漂流瓶', 'palace',
  ])) return TOPICS.PALACE;

  if (hasAny(text, [
    '重要的人', '重要人物', 'people hall', '聯絡人', '收件人資料',
    '家人資料', '朋友資料', '伴侶資料',
  ])) return TOPICS.PEOPLE;

  if (hasAny(text, [
    '重要日期', '揭密日', '生日提醒', '紀念日', '日曆', 'calendar',
  ])) return TOPICS.IMPORTANT_DATES;

  if (hasAny(text, [
    '漂流瓶', '回憶之海', '匿名故事', '匿名嗎', '看得到我是誰',
    '留言', '分支回覆', '收藏故事', '按讚',
  ])) return TOPICS.DRIFT_BOTTLE;

  if (hasAny(text, [
    '語音', '聲音', 'whisper', '光之共鳴', '為什麼不能說話',
    '為什麼不是每次都有語音', 'elevenlabs',
  ])) return TOPICS.VOICE;

  if (hasAny(text, [
    '會員', '免費版', '付費', '月費', '年費', '擴充包',
    '11.99', '79美元', '89美元', '99美元',
  ])) return TOPICS.MEMBERSHIP;

  if (hasAny(text, [
    'me頁面', '設定', '聖殿身分', '個人資料', 'email',
    '手機', '座右銘', '語言設定',
  ])) return TOPICS.SETTINGS;

  if (hasAny(text, [
    '通知', '推播', '提醒', 'fcm',
  ])) return TOPICS.NOTIFICATIONS;

  if (hasAny(text, [
    '客服', '聯絡我們', '問題回報', '技術支援',
    '產品建議', '合作洽詢',
  ])) return TOPICS.SUPPORT;

  if (hasAny(text, [
    '這個app', '這個 app', '可以做什麼', '有哪些功能',
    '怎麼玩', '玩法', '功能介紹',
  ])) return TOPICS.PRODUCT;

  return TOPICS.GENERAL;
}

module.exports = {
  TOPICS,
  routeGuardianTopic,
};
