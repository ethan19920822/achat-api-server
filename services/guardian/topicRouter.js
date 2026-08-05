'use strict';

const TOPICS = Object.freeze({
  GENERAL: 'general',
  WORLD: 'world',
  GUARDIAN: 'guardian',
  CAPSULE: 'capsule',
  PALACE: 'palace',
  RECIPIENTS: 'recipients',
  DRIFT_BOTTLE: 'driftBottle',
  VOICE: 'voice',
  MEMBERSHIP: 'membership',
  SETTINGS: 'settings',
  SUPPORT: 'support',
  PRODUCT: 'product',
});

function text(value) {
  return String(value || '').trim().toLowerCase();
}

function hasAny(source, words) {
  return words.some((word) => source.includes(text(word)));
}

function routeGuardianTopic(message) {
  const source = text(message);
  if (!source) return TOPICS.GENERAL;

  if (hasAny(source, [
    '阿卡西是什麼', '阿卡西紀錄廳', '世界觀', '神話',
    '光還沒有名字', 'akasha cube 是什麼', '阿卡西方塊是什麼',
  ])) return TOPICS.WORLD;

  if (hasAny(source, [
    '你是誰', '妳是誰', '守護者是誰', '小精靈', '你的名字',
    '妳的名字', '你叫什麼', '妳叫什麼',
  ])) return TOPICS.GUARDIAN;

  if (hasAny(source, [
    '時間膠囊', '祝福膠囊', '希望膠囊', '收藏膠囊', '自我膠囊',
    '寫給未來', '寄給未來', '未來的自己', '指定日期',
  ])) return TOPICS.CAPSULE;

  if (hasAny(source, [
    '膠囊收發室', '等待寄送', '等待中的膠囊', '回憶區',
    '膠囊箱', '宮殿', 'palace',
  ])) return TOPICS.PALACE;

  if (hasAny(source, [
    '收件人', '新增收件人', '收件人資料', '寄給誰',
  ])) return TOPICS.RECIPIENTS;

  if (hasAny(source, [
    '漂流瓶', '回憶之海', '匿名故事', '匿名分享',
    '留言', '收藏故事', '按讚', '回覆',
  ])) return TOPICS.DRIFT_BOTTLE;

  if (hasAny(source, [
    '語音祝福', '守護者的聲音', '聽到你的聲音', '語音訊息',
    '聲音', '語音',
  ])) return TOPICS.VOICE;

  if (hasAny(source, [
    '會員', 'traveler', 'akasha member', '免費方案',
    '月費', '年費', '加值', '記憶延伸', '膠囊典藏',
  ])) return TOPICS.MEMBERSHIP;

  if (hasAny(source, [
    'me', '設定', '個人資料', '語言', '通知', '隱私',
    '服務條款', '帳號',
  ])) return TOPICS.SETTINGS;

  if (hasAny(source, [
    '聯絡我們', '客服', '問題回報', '產品建議', '合作洽詢',
  ])) return TOPICS.SUPPORT;

  if (hasAny(source, [
    '這個 app', '這個app', '可以做什麼', '有哪些功能',
    '怎麼使用', '功能介紹',
  ])) return TOPICS.PRODUCT;

  return TOPICS.GENERAL;
}

module.exports = { TOPICS, routeGuardianTopic };
