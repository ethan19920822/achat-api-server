const express = require('express');
const router = express.Router();

const {
  generateCapsuleInterviewQuestion,
  generateCapsuleStoryDraft,
} = require('../services/capsuleAiService');

const {
  processDueCapsules,
  sendOneCapsule,
} = require('../services/capsuleDeliveryWorker');

function assertQueueSecret(req, res) {
  const secret = process.env.EMAIL_QUEUE_SECRET;
  if (!secret) return true;

  const incoming =
    req.headers['x-email-queue-secret'] ||
    req.query.secret ||
    req.body?.secret;

  if (incoming === secret) return true;

  res.status(401).json({ error: 'Unauthorized email queue request' });
  return false;
}

router.post('/interview', async (req, res) => {
  try {
    const question = await generateCapsuleInterviewQuestion(req.body || {});

    res.json({
      reply: question,
      question,
    });
  } catch (error) {
    console.error('Capsule interview route error:', error);

    res.status(500).json({
      error: 'Capsule interview failed',
      reply: '這段記憶裡，你最想讓未來的誰明白哪一個瞬間？',
    });
  }
});

router.post('/story', async (req, res) => {
  try {
    const story = await generateCapsuleStoryDraft(req.body || {});

    res.json({
      reply: story,
      story,
    });
  } catch (error) {
    console.error('Capsule story route error:', error);

    res.status(500).json({
      error: 'Capsule story failed',
      reply: fallbackStory(req.body || {}),
    });
  }
});

// Email Queue v2.0
// 手動觸發：POST /capsule/process-due-emails
router.post('/process-due-emails', async (req, res) => {
  if (!assertQueueSecret(req, res)) return;

  try {
    const result = await processDueCapsules({ limit: req.body?.limit });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('process-due-emails error:', error?.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error?.response?.data || error.message || 'Email queue failed',
    });
  }
});

// 單封測試：POST /capsule/send-one/:capsuleId
router.post('/send-one/:capsuleId', async (req, res) => {
  if (!assertQueueSecret(req, res)) return;

  try {
    const result = await sendOneCapsule(req.params.capsuleId);
    res.json({ ok: true, result });
  } catch (error) {
    console.error('send-one error:', error?.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error?.response?.data || error.message || 'Send one failed',
    });
  }
});

router.get('/delivery-health', (req, res) => {
  res.json({
    ok: true,
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    firebaseConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
    workerEnabled: String(process.env.EMAIL_WORKER_ENABLED || 'true').toLowerCase() !== 'false',
    from: process.env.CAPSULE_FROM_EMAIL || 'Akasha Cube <onboarding@resend.dev>',
  });
});

function fallbackStory(body) {
  const rawText = String(body.rawText || '').trim();

  return `
這是一段我想好好保存下來的記憶。

${rawText || '那是一段我一直放在心裡的記憶。'}

它也許不是什麼驚天動地的大事，但它曾經真實地停在我的生活裡，也停在我的心裡。

如果未來某一天你收到這顆膠囊，我希望你知道，這些話不是突然想起，而是我曾經很認真地想把這一刻留下來。

願那時候的你，能重新感覺到這段記憶還帶著一點溫度。
`.trim();
}

module.exports = router;
