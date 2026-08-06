'use strict';

const TOPICS = Object.freeze({
  GENERAL: 'general', WORLD: 'world', GUARDIAN: 'guardian', CAPSULE: 'capsule',
  PALACE: 'palace', RECIPIENTS: 'recipients', DRIFT_BOTTLE: 'driftBottle',
  VOICE: 'voice', MEMBERSHIP: 'membership', SETTINGS: 'settings', PRODUCT: 'product',
});

const MAP = [
  ['world', ['阿卡西是什麼','阿卡西紀錄廳','世界觀','神話','akasha cube 是什麼']],
  ['guardian', ['你是誰','妳是誰','小精靈','守護者是誰','你叫什麼','妳叫什麼']],
  ['capsule', ['時間膠囊','祝福膠囊','希望膠囊','收藏膠囊','自我膠囊','寫給未來']],
  ['palace', ['膠囊收發室','等待寄送','回憶區','膠囊箱','palace']],
  ['recipients', ['收件人','新增收件人','寄給誰']],
  ['driftBottle', ['漂流瓶','回憶之海','匿名故事','留言','收藏故事','按讚']],
  ['voice', ['akasha whisper','語音祝福','守護者的聲音','語音訊息']],
  ['membership', ['會員','免費方案','月費','年費','加值','akasha member']],
  ['settings', ['me','設定','個人資料','通知','隱私','服務條款','帳號']],
  ['product', ['這個app','這個 app','可以做什麼','有哪些功能','功能介紹']],
];

function routeGuardianTopic(message) {
  const source = String(message || '').trim().toLowerCase();
  for (const [topic, words] of MAP) {
    if (words.some((word) => source.includes(word.toLowerCase()))) return topic;
  }
  return TOPICS.GENERAL;
}

module.exports = { TOPICS, routeGuardianTopic };
