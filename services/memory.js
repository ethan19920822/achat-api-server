const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function normalizeText(text) {
  return String(text || '').trim();
}

function uniqueMerge(oldList = [], newList = []) {
  const set = new Set(
    [...oldList, ...newList]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
  );
  return Array.from(set);
}

function containsAny(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}

function extractMemoryFromMessage(message) {
  const text = normalizeText(message);

  const result = {
    importantPeople: [],
    lifeEvents: [],
    emotionalTraits: [],
    longTermWishes: [],
  };

  // -------------------------
  // 1) importantPeople
  // -------------------------
  const peopleRules = [
    { keywords: ['媽媽', '母親', '媽'], value: '媽媽' },
    { keywords: ['爸爸', '父親', '爸'], value: '爸爸' },
    { keywords: ['前任'], value: '前任' },
    { keywords: ['男友'], value: '男友' },
    { keywords: ['女友'], value: '女友' },
    { keywords: ['老公', '丈夫'], value: '丈夫' },
    { keywords: ['老婆', '妻子'], value: '妻子' },
    { keywords: ['伴侶'], value: '伴侶' },
    { keywords: ['朋友', '好友'], value: '朋友' },
    { keywords: ['同事'], value: '同事' },
    { keywords: ['哥哥'], value: '哥哥' },
    { keywords: ['姐姐'], value: '姐姐' },
    { keywords: ['弟弟'], value: '弟弟' },
    { keywords: ['妹妹'], value: '妹妹' },
    { keywords: ['兄弟'], value: '兄弟' },
    { keywords: ['姊妹', '姐妹'], value: '姊妹' },
    { keywords: ['家人', '家庭'], value: '家人' },
    { keywords: ['孩子', '小孩', '兒子', '女兒'], value: '孩子' },
  ];

  for (const rule of peopleRules) {
    if (containsAny(text, rule.keywords)) {
      result.importantPeople.push(rule.value);
    }
  }

  // -------------------------
  // 2) lifeEvents
  // -------------------------
  const eventRules = [
    { keywords: ['分手'], value: '分手' },
    { keywords: ['搬家'], value: '搬家' },
    { keywords: ['創業'], value: '創業' },
    { keywords: ['結婚'], value: '結婚' },
    { keywords: ['離婚'], value: '離婚' },
    { keywords: ['離職'], value: '離職' },
    { keywords: ['失業'], value: '失業' },
    { keywords: ['過世', '離世'], value: '親人離世' },
    { keywords: ['生病', '住院'], value: '生病' },
    { keywords: ['吵架'], value: '關係衝突' },
    { keywords: ['背叛'], value: '被背叛' },
    { keywords: ['壓力很大', '工作壓力'], value: '工作壓力很大' },
    { keywords: ['家裡壓力', '家庭壓力'], value: '家庭壓力很大' },
  ];

  for (const rule of eventRules) {
    if (containsAny(text, rule.keywords)) {
      result.lifeEvents.push(rule.value);
    }
  }

  // -------------------------
  // 3) emotionalTraits
  // -------------------------
  const emotionRules = [
    { keywords: ['焦慮'], value: '容易焦慮' },
    { keywords: ['想很多'], value: '容易想很多' },
    { keywords: ['難過'], value: '容易難過' },
    { keywords: ['委屈'], value: '容易委屈' },
    { keywords: ['壓力', '壓力大'], value: '壓力大' },
    { keywords: ['想念'], value: '容易想念' },
    { keywords: ['自責'], value: '容易自責' },
    { keywords: ['孤單', '孤獨'], value: '容易感到孤單' },
    { keywords: ['樂觀'], value: '樂觀' },
    { keywords: ['悲觀'], value: '偏悲觀' },
    { keywords: ['敏感'], value: '敏感' },
    { keywords: ['重感情'], value: '重感情' },
    { keywords: ['害怕'], value: '容易害怕' },
    { keywords: ['累', '疲憊'], value: '容易疲憊' },
  ];

  for (const rule of emotionRules) {
    if (containsAny(text, rule.keywords)) {
      result.emotionalTraits.push(rule.value);
    }
  }

  // -------------------------
  // 4) longTermWishes
  // -------------------------
  const wishRules = [
    { keywords: ['想被理解', '被理解'], value: '想被理解' },
    { keywords: ['想賺錢', '賺錢'], value: '想賺錢' },
    { keywords: ['想成功', '成功'], value: '想成功' },
    { keywords: ['想修復', '修復關係', '想和好', '和好'], value: '想修復關係' },
    { keywords: ['想留下', '留下重要的話', '留給未來'], value: '想留下重要的話' },
    { keywords: ['照顧家人'], value: '想照顧家人' },
    { keywords: ['重新開始'], value: '想重新開始' },
    { keywords: ['獲得尊重', '被尊重'], value: '想獲得尊重' },
  ];

  for (const rule of wishRules) {
    if (containsAny(text, rule.keywords)) {
      result.longTermWishes.push(rule.value);
    }
  }

  result.importantPeople = Array.from(new Set(result.importantPeople));
  result.lifeEvents = Array.from(new Set(result.lifeEvents));
  result.emotionalTraits = Array.from(new Set(result.emotionalTraits));
  result.longTermWishes = Array.from(new Set(result.longTermWishes));

  return result;
}

async function mergeMemoryProfileToFirestore(userId, extracted) {
  if (!userId) return;
  if (!extracted) return;

  const ref = db
    .collection('users')
    .doc(userId)
    .collection('master_profile')
    .doc('main');

  const snap = await ref.get();
  const current = snap.exists ? snap.data() || {} : {};

  const nextData = {
    importantPeople: uniqueMerge(current.importantPeople, extracted.importantPeople),
    lifeEvents: uniqueMerge(current.lifeEvents, extracted.lifeEvents),
    emotionalTraits: uniqueMerge(current.emotionalTraits, extracted.emotionalTraits),
    longTermWishes: uniqueMerge(current.longTermWishes, extracted.longTermWishes),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.set(nextData, { merge: true });
}

module.exports = {
  extractMemoryFromMessage,
  mergeMemoryProfileToFirestore,
};
