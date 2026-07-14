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

async function loadSituation(userId) {
  if (!userId) return {};
  const db = getDb();
  if (!db) return {};
  const snap = await db.collection('users').doc(userId).collection('momo_brain').doc('current_situation').get();
  return snap.data() || {};
}

async function saveSituation(userId, situation) {
  if (!userId || !situation) return;
  const db = getDb();
  if (!db) return;
  await db.collection('users').doc(userId).collection('momo_brain').doc('current_situation').set({
    ...situation,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = {
  loadSituation,
  saveSituation,
};
