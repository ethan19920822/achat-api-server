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

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function safeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((e) => String(e || '').trim()).filter(Boolean);
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[DRIFT_ROUTE] FIREBASE_SERVICE_ACCOUNT_JSON missing. Admin write disabled.');
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

function requireDb(res) {
  const firestore = getDb();
  if (!firestore) {
    res.status(500).json({ ok: false, error: 'Firebase Admin unavailable' });
    return null;
  }
  return firestore;
}

function requireAdminKey(req, res) {
  const expected = process.env.DRIFT_ADMIN_KEY;
  if (!expected) {
    res.status(403).json({ ok: false, error: 'Official bottle disabled' });
    return false;
  }
  const actual = req.headers['x-akasha-admin-key'];
  if (actual !== expected) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

async function writePrivateMeta({
  postId,
  userId,
  result,
  sourceType,
  rawTitle,
  rawContent,
}) {
  if (!postId) return;

  const firestore = getDb();
  if (!firestore) return;

  await firestore.collection('drift_meta').doc(postId).set({
    postId,
    userId: userId || '',
    sourceType: sourceType || '',
    rawTitle: rawTitle || '',
    rawContent: rawContent || '',
    anonymousChanged: Boolean(result.anonymousChanged),
    profanityRatio: Number(result.profanityRatio || 0),
    oceanPenalty: Number(result.oceanPenalty || 0),
    exposureWeight: Number(result.exposureWeight || 1),
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

    if (writeMeta === true && !safeText(postId)) {
      return res.status(400).json({
        ok: false,
        error: 'postId is required when writeMeta is true',
      });
    }

    const result = await shieldBottle({
      userId,
      title: cleanTitle,
      content: cleanContent,
    });

    if (writeMeta === true) {
      await writePrivateMeta({
        postId: safeText(postId),
        userId,
        result,
        sourceType,
        rawTitle: cleanTitle,
        rawContent: cleanContent,
      });
    }

    return res.json({
      ok: true,
      title: result.title,
      content: result.content,
      anonymousChanged: result.anonymousChanged,
      shieldVersion: result.shieldVersion,
      fallback: result.fallback,
    });
  } catch (error) {
    console.error('[DRIFT_SHIELD_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: 'Drift shield failed',
    });
  }
});

router.post('/publish', async (req, res) => {
  try {
    const firestore = requireDb(res);
    if (!firestore) return;

    const {
      userId,
      title,
      content,
      sourceType,
      allowComments,
      imageUrls,
      coverImageUrl,
      audioUrl,
      audioDurationSec,
      capsuleDraftId,
      capsuleSource,
    } = req.body || {};

    const cleanUserId = safeText(userId);
    const cleanTitle = safeText(title);
    const cleanContent = safeText(content);

    if (!cleanUserId) {
      return res.status(400).json({ ok: false, error: 'userId is required' });
    }
    if (!cleanTitle && !cleanContent) {
      return res.status(400).json({ ok: false, error: 'title or content is required' });
    }

    const postRef = firestore.collection('drift_posts').doc();

    const result = await shieldBottle({
      userId: cleanUserId,
      title: cleanTitle,
      content: cleanContent,
    });

    const urls = safeArray(imageUrls).slice(0, 3);
    const cover = safeText(coverImageUrl) || (urls.length ? urls[0] : '');
    const source = safeText(sourceType) || 'user';

    await postRef.set({
      title: result.title,
      content: result.content,
      authorUid: cleanUserId,
      authorName: '未知旅人',
      anonymousName: '未知旅人',
      isAnonymous: true,
      type: source === 'capsule' ? 'capsule' : 'user',
      sourceType: source,
      capsuleSource: safeText(capsuleSource) || source,
      capsuleDraftId: safeText(capsuleDraftId),
      status: 'published',
      allowComments: safeBool(allowComments, true),
      imageUrls: urls,
      coverImageUrl: cover,
      audioUrl: safeText(audioUrl),
      audioDurationSec: Math.max(0, Math.trunc(safeNumber(audioDurationSec, 0))),
      isOfficial: false,
      hasVideo: false,
      likeCount: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await writePrivateMeta({
      postId: postRef.id,
      userId: cleanUserId,
      result,
      sourceType: source,
      rawTitle: cleanTitle,
      rawContent: cleanContent,
    });

    return res.json({
      ok: true,
      postId: postRef.id,
      title: result.title,
      content: result.content,
      anonymousChanged: result.anonymousChanged,
      shieldVersion: result.shieldVersion,
      fallback: result.fallback,
    });
  } catch (error) {
    console.error('[DRIFT_PUBLISH_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Drift publish failed' });
  }
});

router.post('/meta', async (req, res) => {
  try {
    const {
      postId,
      userId,
      sourceType,
      rawTitle,
      rawContent,
      anonymousChanged,
      profanityRatio,
      oceanPenalty,
      exposureWeight,
      shieldVersion,
      fallback,
      fallbackReason,
    } = req.body || {};

    if (!safeText(postId)) {
      return res.status(400).json({ ok: false, error: 'postId is required' });
    }

    const firestore = requireDb(res);
    if (!firestore) return;

    await firestore.collection('drift_meta').doc(safeText(postId)).set({
      postId: safeText(postId),
      userId: safeText(userId),
      sourceType: safeText(sourceType),
      rawTitle: safeText(rawTitle),
      rawContent: safeText(rawContent),
      anonymousChanged: Boolean(anonymousChanged),
      profanityRatio: Number(profanityRatio || 0),
      oceanPenalty: Number(oceanPenalty || 0),
      exposureWeight: Number(exposureWeight || 1),
      shieldVersion: shieldVersion || SHIELD_VERSION,
      fallback: Boolean(fallback),
      fallbackReason: safeText(fallbackReason),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.json({ ok: true });
  } catch (error) {
    console.error('[DRIFT_META_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Meta write failed' });
  }
});

router.post('/like', async (req, res) => {
  try {
    const firestore = requireDb(res);
    if (!firestore) return;

    const { postId, userId } = req.body || {};
    const cleanPostId = safeText(postId);
    const cleanUserId = safeText(userId);

    if (!cleanPostId || !cleanUserId) {
      return res.status(400).json({ ok: false, error: 'postId and userId are required' });
    }

    const postRef = firestore.collection('drift_posts').doc(cleanPostId);
    const likeRef = postRef.collection('likes').doc(cleanUserId);

    let liked = false;
    let likeCount = 0;

    await firestore.runTransaction(async (tx) => {
      const likeSnap = await tx.get(likeRef);
      const postSnap = await tx.get(postRef);
      const current = Number(postSnap.data()?.likeCount || 0);

      if (likeSnap.exists) {
        liked = false;
        likeCount = Math.max(0, current - 1);
        tx.delete(likeRef);
      } else {
        liked = true;
        likeCount = current + 1;
        tx.set(likeRef, {
          uid: cleanUserId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      tx.update(postRef, {
        likeCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.json({ ok: true, liked, likeCount });
  } catch (error) {
    console.error('[DRIFT_LIKE_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Like failed' });
  }
});

router.post('/save', async (req, res) => {
  try {
    const firestore = requireDb(res);
    if (!firestore) return;

    const { postId, userId } = req.body || {};
    const cleanPostId = safeText(postId);
    const cleanUserId = safeText(userId);

    if (!cleanPostId || !cleanUserId) {
      return res.status(400).json({ ok: false, error: 'postId and userId are required' });
    }

    const postRef = firestore.collection('drift_posts').doc(cleanPostId);
    const saveRef = firestore
      .collection('users')
      .doc(cleanUserId)
      .collection('drift_saved')
      .doc(cleanPostId);

    let saved = false;
    let saveCount = 0;

    await firestore.runTransaction(async (tx) => {
      const saveSnap = await tx.get(saveRef);
      const postSnap = await tx.get(postRef);
      const current = Number(postSnap.data()?.saveCount || 0);

      if (saveSnap.exists) {
        saved = false;
        saveCount = Math.max(0, current - 1);
        tx.delete(saveRef);
      } else {
        saved = true;
        saveCount = current + 1;
        tx.set(saveRef, {
          postId: cleanPostId,
          savedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      tx.update(postRef, {
        saveCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.json({ ok: true, saved, saveCount });
  } catch (error) {
    console.error('[DRIFT_SAVE_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Save failed' });
  }
});

router.post('/comment', async (req, res) => {
  try {
    const firestore = requireDb(res);
    if (!firestore) return;

    const { postId, userId, content, parentCommentId } = req.body || {};
    const cleanPostId = safeText(postId);
    const cleanUserId = safeText(userId);
    const cleanContent = safeText(content);
    const cleanParent = safeText(parentCommentId);

    if (!cleanPostId || !cleanUserId || !cleanContent) {
      return res.status(400).json({ ok: false, error: 'postId, userId and content are required' });
    }

    const postRef = firestore.collection('drift_posts').doc(cleanPostId);
    const commentRef = postRef.collection('comments').doc();

    await firestore.runTransaction(async (tx) => {
      const postSnap = await tx.get(postRef);
      const current = Number(postSnap.data()?.commentCount || 0);

      tx.set(commentRef, {
        uid: cleanUserId,
        content: cleanContent,
        anonymousName: '未知旅人',
        parentCommentId: cleanParent,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        likeCount: 0,
      });

      tx.update(postRef, {
        commentCount: current + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.json({ ok: true, commentId: commentRef.id });
  } catch (error) {
    console.error('[DRIFT_COMMENT_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Comment failed' });
  }
});

router.post('/comment-like', async (req, res) => {
  try {
    const firestore = requireDb(res);
    if (!firestore) return;

    const { postId, commentId, userId } = req.body || {};
    const cleanPostId = safeText(postId);
    const cleanCommentId = safeText(commentId);
    const cleanUserId = safeText(userId);

    if (!cleanPostId || !cleanCommentId || !cleanUserId) {
      return res.status(400).json({ ok: false, error: 'postId, commentId and userId are required' });
    }

    const commentRef = firestore
      .collection('drift_posts')
      .doc(cleanPostId)
      .collection('comments')
      .doc(cleanCommentId);
    const likeRef = commentRef.collection('likes').doc(cleanUserId);

    let liked = false;
    let likeCount = 0;

    await firestore.runTransaction(async (tx) => {
      const likeSnap = await tx.get(likeRef);
      const commentSnap = await tx.get(commentRef);
      const current = Number(commentSnap.data()?.likeCount || 0);

      if (likeSnap.exists) {
        liked = false;
        likeCount = Math.max(0, current - 1);
        tx.delete(likeRef);
      } else {
        liked = true;
        likeCount = current + 1;
        tx.set(likeRef, {
          uid: cleanUserId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      tx.update(commentRef, { likeCount });
    });

    return res.json({ ok: true, liked, likeCount });
  } catch (error) {
    console.error('[DRIFT_COMMENT_LIKE_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Comment like failed' });
  }
});

router.post('/share', async (req, res) => {
  try {
    const firestore = requireDb(res);
    if (!firestore) return;

    const { postId } = req.body || {};
    const cleanPostId = safeText(postId);

    if (!cleanPostId) {
      return res.status(400).json({ ok: false, error: 'postId is required' });
    }

    const url = `https://akashacube.vip/drift/${cleanPostId}`;

    await firestore.collection('drift_posts').doc(cleanPostId).update({
      shareCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, url });
  } catch (error) {
    console.error('[DRIFT_SHARE_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Share failed' });
  }
});

router.post('/official', async (req, res) => {
  try {
    if (!requireAdminKey(req, res)) return;
    const firestore = requireDb(res);
    if (!firestore) return;

    const {
      title,
      content,
      imageUrls,
      coverImageUrl,
      audioUrl,
      audioDurationSec,
      videoUrl,
      allowComments,
      pinned,
    } = req.body || {};

    const postRef = firestore.collection('drift_posts').doc();
    const urls = safeArray(imageUrls).slice(0, 6);
    const cover = safeText(coverImageUrl) || (urls.length ? urls[0] : '');

    await postRef.set({
      title: safeText(title) || 'Akasha Cube',
      content: safeText(content),
      authorUid: 'official',
      authorName: 'Akasha Cube',
      anonymousName: 'Akasha Cube',
      isAnonymous: false,
      type: 'official',
      sourceType: 'official',
      capsuleSource: 'official',
      status: 'published',
      allowComments: safeBool(allowComments, true),
      imageUrls: urls,
      coverImageUrl: cover,
      audioUrl: safeText(audioUrl),
      audioDurationSec: Math.max(0, Math.trunc(safeNumber(audioDurationSec, 0))),
      videoUrl: safeText(videoUrl),
      hasVideo: Boolean(safeText(videoUrl)),
      isOfficial: true,
      pinned: Boolean(pinned),
      likeCount: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, postId: postRef.id });
  } catch (error) {
    console.error('[DRIFT_OFFICIAL_ROUTE_ERROR]', error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: 'Official publish failed' });
  }
});

module.exports = router;
