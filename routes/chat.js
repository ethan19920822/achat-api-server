const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { getChatReply } = require('../services/core');

const recentRequests = new Map();

const SAME_REQUEST_TTL_MS = 10000;
const MAX_CACHE_SIZE = 500;

function safeText(value) {
  return String(value || '').trim();
}

function makeRequestKey(userId, message) {
  const raw = `${userId || 'anonymous'}::${safeText(message)}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function cleanupRecentRequests() {
  const now = Date.now();

  for (const [key, value] of recentRequests.entries()) {
    if (now - value.createdAt > SAME_REQUEST_TTL_MS) {
      recentRequests.delete(key);
    }
  }

  if (recentRequests.size > MAX_CACHE_SIZE) {
    const keys = Array.from(recentRequests.keys());
    const removeCount = recentRequests.size - MAX_CACHE_SIZE;

    for (let i = 0; i < removeCount; i += 1) {
      recentRequests.delete(keys[i]);
    }
  }
}

router.post('/', async (req, res) => {
  const {
    userId,
    message,
    recentMessages,
    memoryProfile,
  } = req.body;

  const cleanMessage = safeText(message);

  if (!cleanMessage) {
    return res.status(400).json({ error: 'Message is required' });
  }

  cleanupRecentRequests();

  const requestKey = makeRequestKey(userId, cleanMessage);
  const existing = recentRequests.get(requestKey);

  if (existing && Date.now() - existing.createdAt < SAME_REQUEST_TTL_MS) {
    console.log('⚠️ Duplicate chat request blocked:', {
      userId: userId || 'anonymous',
      ageMs: Date.now() - existing.createdAt,
    });

    return res.json({
      reply: existing.reply || 'Momo 正在整理這句話，先等我一下😆',
      duplicate: true,
    });
  }

  recentRequests.set(requestKey, {
    createdAt: Date.now(),
    reply: '',
  });

  try {
    const reply = await getChatReply(
      cleanMessage,
      userId,
      recentMessages,
      memoryProfile
    );

    recentRequests.set(requestKey, {
      createdAt: Date.now(),
      reply,
    });

    res.json({ reply });
  } catch (error) {
    console.error('Error generating reply:', error);

    recentRequests.delete(requestKey);

    res.status(500).json({
      error: 'Failed to get reply',
      reply: 'Momo 剛剛斷線了，膠囊內容已先保留。',
    });
  }
});

module.exports = router;
