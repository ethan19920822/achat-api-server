'use strict';

const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(parsed) });
  }
  return admin.firestore();
}

async function touchRelationship(userId) {
  if (!userId) return {};
  const db = getDb();
  if (!db) return {};

  const ref = db.collection('users').doc(userId).collection('momo_brain').doc('relationship');
  const snap = await ref.get();
  const now = new Date();
  const data = snap.data() || {};
  const firstSeen = data.firstSeenAtLocal ? new Date(data.firstSeenAtLocal) : now;
  const previousLastSeen = data.lastSeenAtLocal ? new Date(data.lastSeenAtLocal) : null;

  await ref.set({
    firstSeenAtLocal: firstSeen.toISOString(),
    lastSeenAtLocal: now.toISOString(),
    messageCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ifSchemaVersion: 1,
  }, { merge: true });

  const knownMinutes = Math.max(0, Math.round((now - firstSeen) / 60000));
  const gapMinutes = previousLastSeen
    ? Math.max(0, Math.round((now - previousLastSeen) / 60000))
    : null;

  return {
    firstSeenAtLocal: firstSeen.toISOString(),
    knownMinutes,
    gapMinutes,
  };
}

function humanizeDuration(minutes) {
  if (minutes == null) return '';
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  const months = Math.floor(days / 30);
  const remainDays = days % 30;
  return remainDays ? `${months} 個月 ${remainDays} 天` : `${months} 個月`;
}

module.exports = {
  touchRelationship,
  humanizeDuration,
};
