'use strict';

const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(parsed),
    });
  }

  return admin.firestore();
}

function emptySituation() {
  return {
    who: '',
    what: '',
    when: '',
    currentWhere: '',
    eventWhere: '',
    emotion: '',
    why: '',
    how: '',
    unknown: [],
  };
}

async function loadSituation(userId) {
  if (!userId) return emptySituation();

  const db = getDb();
  if (!db) return emptySituation();

  try {
    const ref = db
        .collection('users')
        .doc(userId)
        .collection('momo_brain')
        .doc('situation');

    const snap = await ref.get();
    if (!snap.exists) return emptySituation();

    return {
      ...emptySituation(),
      ...(snap.data() || {}),
    };
  } catch (error) {
    console.error('[MOMO_SITUATION_STORE] load failed', {
      userId,
      message: error?.message || String(error),
    });
    return emptySituation();
  }
}

async function saveSituation(userId, situation = {}) {
  if (!userId) return;

  const db = getDb();
  if (!db) return;

  try {
    const ref = db
        .collection('users')
        .doc(userId)
        .collection('momo_brain')
        .doc('situation');

    await ref.set(
      {
        ...emptySituation(),
        ...situation,
        updatedAtLocal: new Date().toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 1,
      },
      { merge: true },
    );
  } catch (error) {
    console.error('[MOMO_SITUATION_STORE] save failed', {
      userId,
      message: error?.message || String(error),
    });
  }
}

module.exports = {
  loadSituation,
  saveSituation,
};
