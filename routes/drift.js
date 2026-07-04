const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

const {
  shieldBottle,
  SHIELD_VERSION,
} = require('../services/driftShieldService');

function safeText(value) {
  return String(value || '').trim();
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[DRIFT_ROUTE] FIREBASE_SERVICE_ACCOUNT missing. drift_meta write disabled.');
    return null;
  }

  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin.firestore();
}

let db = null;

function getDb() {
  if (db) return db;
  try {
    db = initFirebaseAdmin();
    return db;
  } catch (error) {
    console.error('[DRIFT_ROUTE] Firebase Admin init failed:', error.message);
    return null;
  }
}

async function writePrivateMeta({
  postId,
  userId,
  result,
  sourceType,
}) {
  if (!postId) return;

  const firestore = getDb();
  if (!firestore) return;

  await firestore.collection('drift_meta').doc(postId).set({
    postId,
    userId: userId || '',
    sourceType: sourceType || '',
    anonymousChanged: Boolean(result.anonymousChanged),
    profanityRatio: Number(result.profanityRatio || 0),
    oceanPenalty: Number(result.oceanPenalty || 0),
    shieldVersion: result.shieldVersion || SHIELD_VERSION,
    fallback: Boolean(result.fallback),
    fallbackReason: result.fallbackReason || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

router.post('/shield', async (req, res) => {
  try {
    const {
      userId,
      postId,
      title,
      content,
      sourceType,
      writeMeta,
    } = req.body || {};

    const cleanTitle = safeText(title);
    const cleanContent = safeText(content);

    if (!cleanTitle && !cleanContent) {
      return res.status(400).json({
        ok: false,
        error: 'title or content is required',
      });
    }

    const result = await shieldBottle({
      userId,
      title: cleanTitle,
      content: cleanContent,
    });

    if (writeMeta === true && postId) {
      await writePrivateMeta({
        postId,
        userId,
        result,
        sourceType,
      });
    }

    return res.json({
      ok: true,
      title: result.title,
      content: result.content,

      // Flutter 先只拿 title/content；這些不要寫進 drift_posts。
      anonymousChanged: result.anonymousChanged,
      shieldVersion: result.shieldVersion,
    });
  } catch (error) {
    console.error('[DRIFT_SHIELD_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: 'Drift shield failed',
    });
  }
});

router.post('/meta', async (req, res) => {
  try {
    const {
      postId,
      userId,
      sourceType,
      anonymousChanged,
      profanityRatio,
      oceanPenalty,
      shieldVersion,
      fallback,
      fallbackReason,
    } = req.body || {};

    if (!postId) {
      return res.status(400).json({ ok: false, error: 'postId is required' });
    }

    const firestore = getDb();
    if (!firestore) {
      return res.status(500).json({ ok: false, error: 'Firebase Admin unavailable' });
    }

    await firestore.collection('drift_meta').doc(postId).set({
      postId,
      userId: userId || '',
      sourceType: sourceType || '',
      anonymousChanged: Boolean(anonymousChanged),
      profanityRatio: Number(profanityRatio || 0),
      oceanPenalty: Number(oceanPenalty || 0),
      shieldVersion: shieldVersion || SHIELD_VERSION,
      fallback: Boolean(fallback),
      fallbackReason: fallbackReason || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.json({ ok: true });
  } catch (error) {
    console.error('[DRIFT_META_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Meta write failed' });
  }
});

module.exports = router;
