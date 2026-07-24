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


function adminPostQuery(firestore, { status = '', type = '', limit = 100 } = {}) {
  let query = firestore.collection('drift_posts');
  if (status) query = query.where('status', '==', status);
  if (type) query = query.where('type', '==', type);
  return query.orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(500, Number(limit) || 100)));
}

async function deleteCollectionInBatches(query, batchSize = 200) {
  while (true) {
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) return;
    const batch = snapshot.docs[0].ref.firestore.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();
    if (snapshot.size < batchSize) return;
  }
}

async function deleteCommentTree(commentRef) {
  await deleteCollectionInBatches(commentRef.collection('likes'));
  await commentRef.delete();
}

async function deletePostCascade(firestore, postId) {
  const postRef = firestore.collection('drift_posts').doc(postId);
  const comments = await postRef.collection('comments').get();
  for (const comment of comments.docs) await deleteCommentTree(comment.ref);
  await deleteCollectionInBatches(postRef.collection('likes'));
  const savedRefs = await firestore.collectionGroup('drift_saved').where('postId', '==', postId).get();
  for (const saved of savedRefs.docs) await saved.ref.delete();
  await firestore.collection('drift_meta').doc(postId).delete().catch(() => {});
  await postRef.delete();
  return { postId, deletedComments: comments.size, deletedSavedRefs: savedRefs.size };
}

router.get('/admin/stats', async (req, res) => {
  try {
    if (!requireAdminKey(req, res)) return;
    const firestore = requireDb(res); if (!firestore) return;
    const snapshot = await firestore.collection('drift_posts').get();
    const stats = { total:0, published:0, draft:0, archived:0, official:0, user:0, seed:0, likes:0, comments:0, saves:0, shares:0 };
    for (const doc of snapshot.docs) {
      const data = doc.data(); stats.total += 1;
      const status = safeText(data.status) || 'published'; if (Object.prototype.hasOwnProperty.call(stats,status)) stats[status]+=1;
      if (data.isOfficial === true) stats.official += 1;
      if (safeText(data.sourceType) === 'user') stats.user += 1;
      if (safeText(data.sourceType) === 'seed') stats.seed += 1;
      stats.likes += safeNumber(data.likeCount); stats.comments += safeNumber(data.commentCount); stats.saves += safeNumber(data.saveCount); stats.shares += safeNumber(data.shareCount);
    }
    return res.json({ ok:true, stats });
  } catch (error) { console.error('[DRIFT_ADMIN_STATS_ERROR]', error.message); return res.status(500).json({ok:false,error:'Admin stats failed'}); }
});

router.get('/admin/posts', async (req, res) => {
  try {
    if (!requireAdminKey(req, res)) return;
    const firestore = requireDb(res); if (!firestore) return;
    const snapshot = await adminPostQuery(firestore,{status:safeText(req.query.status),type:safeText(req.query.type),limit:req.query.limit}).get();
    return res.json({ok:true,count:snapshot.size,posts:snapshot.docs.map(doc=>({id:doc.id,...doc.data()}))});
  } catch (error) { console.error('[DRIFT_ADMIN_LIST_ERROR]', error.message); return res.status(500).json({ok:false,error:'Admin list failed'}); }
});

router.post('/admin/bulk', async (req, res) => {
  try {
    if (!requireAdminKey(req, res)) return;
    const firestore = requireDb(res); if (!firestore) return;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const defaultStatus = safeText(req.body?.defaultStatus) || 'published';
    const defaultAllowComments = safeBool(req.body?.defaultAllowComments, true);
    if (!items.length) return res.status(400).json({ok:false,error:'items is required'});
    if (items.length > 500) return res.status(400).json({ok:false,error:'maximum 500 items per request'});
    const batch = firestore.batch(); const created=[];
    for (const raw of items) {
      const content = safeText(raw.content || raw.body); if (!content) continue;
      const ref = firestore.collection('drift_posts').doc();
      batch.set(ref, {
        title:safeText(raw.title)||'Akasha Cube', content, authorUid:'official', authorName:'Akasha Cube', anonymousName:'Akasha Cube', isAnonymous:false,
        type:'official', sourceType:'seed', capsuleSource:'seed', status:safeText(raw.status)||defaultStatus,
        allowComments:raw.allowComments===undefined?defaultAllowComments:safeBool(raw.allowComments,defaultAllowComments),
        imageUrls:safeArray(raw.imageUrls).slice(0,6), coverImageUrl:safeText(raw.coverImageUrl), audioUrl:safeText(raw.audioUrl),
        audioDurationSec:Math.max(0,Math.trunc(safeNumber(raw.audioDurationSec,0))), videoUrl:'', hasVideo:false,
        isOfficial:true, pinned:Boolean(raw.pinned), category:safeText(raw.category)||'warm', tone:safeText(raw.tone)||'positive',
        exposureWeight:Math.max(0.1,Math.min(20,safeNumber(raw.weight,1))), seedKey:safeText(raw.seedKey),
        likeCount:0, commentCount:0, saveCount:0, shareCount:0, viewCount:0,
        createdAt:admin.firestore.FieldValue.serverTimestamp(), updatedAt:admin.firestore.FieldValue.serverTimestamp(),
      });
      created.push(ref.id);
    }
    await batch.commit(); return res.json({ok:true,createdCount:created.length,postIds:created});
  } catch (error) { console.error('[DRIFT_ADMIN_BULK_ERROR]', error.message); return res.status(500).json({ok:false,error:'Admin bulk import failed'}); }
});

router.patch('/admin/posts/:postId', async (req, res) => {
  try {
    if (!requireAdminKey(req,res)) return;
    const firestore=requireDb(res); if(!firestore) return;
    const postId=safeText(req.params.postId); if(!postId) return res.status(400).json({ok:false,error:'postId is required'});
    const allowed=['title','content','status','allowComments','pinned','category','tone','exposureWeight','coverImageUrl','audioUrl','audioDurationSec'];
    const patch={}; for(const key of allowed) if(Object.prototype.hasOwnProperty.call(req.body||{},key)) patch[key]=req.body[key];
    if(patch.title!==undefined) patch.title=safeText(patch.title); if(patch.content!==undefined) patch.content=safeText(patch.content);
    if(patch.status!==undefined) patch.status=safeText(patch.status); if(patch.category!==undefined) patch.category=safeText(patch.category); if(patch.tone!==undefined) patch.tone=safeText(patch.tone);
    if(patch.allowComments!==undefined) patch.allowComments=Boolean(patch.allowComments); if(patch.pinned!==undefined) patch.pinned=Boolean(patch.pinned);
    if(patch.exposureWeight!==undefined) patch.exposureWeight=Math.max(0.1,Math.min(20,safeNumber(patch.exposureWeight,1)));
    patch.updatedAt=admin.firestore.FieldValue.serverTimestamp();
    await firestore.collection('drift_posts').doc(postId).set(patch,{merge:true}); return res.json({ok:true,postId});
  } catch(error){ console.error('[DRIFT_ADMIN_UPDATE_ERROR]',error.message); return res.status(500).json({ok:false,error:'Admin update failed'}); }
});

router.delete('/admin/posts/:postId', async (req,res)=>{
  try{ if(!requireAdminKey(req,res)) return; const firestore=requireDb(res); if(!firestore) return; const postId=safeText(req.params.postId); const result=await deletePostCascade(firestore,postId); return res.json({ok:true,...result}); }
  catch(error){ console.error('[DRIFT_ADMIN_DELETE_ERROR]',error.message); return res.status(500).json({ok:false,error:'Admin delete failed'}); }
});

router.post('/admin/cleanup-test', async (req,res)=>{
  try{
    if(!requireAdminKey(req,res)) return; const firestore=requireDb(res); if(!firestore) return;
    const dryRun=req.body?.dryRun!==false; const includeOfficial=req.body?.includeOfficial===true; const beforeIso=safeText(req.body?.before); const before=beforeIso?new Date(beforeIso):null;
    if(beforeIso && Number.isNaN(before?.getTime())) return res.status(400).json({ok:false,error:'invalid before date'});
    const snapshot=await firestore.collection('drift_posts').get(); const candidates=[];
    for(const doc of snapshot.docs){ const data=doc.data(); if(!includeOfficial && data.isOfficial===true) continue; const sourceType=safeText(data.sourceType); const isTest=data.isTest===true||sourceType==='test'||safeText(data.status)==='test'; const createdAt=data.createdAt?.toDate?.()||null; const oldEnough=before?(createdAt&&createdAt<before):false; if(isTest||oldEnough)candidates.push({id:doc.id,title:safeText(data.title),sourceType,isOfficial:data.isOfficial===true,createdAt:createdAt?createdAt.toISOString():''}); }
    if(dryRun) return res.json({ok:true,dryRun:true,candidateCount:candidates.length,candidates});
    const deleted=[]; for(const item of candidates) deleted.push(await deletePostCascade(firestore,item.id));
    return res.json({ok:true,dryRun:false,deletedCount:deleted.length,deleted});
  }catch(error){ console.error('[DRIFT_ADMIN_CLEANUP_ERROR]',error.message); return res.status(500).json({ok:false,error:'Admin cleanup failed'}); }
});

module.exports = router;
