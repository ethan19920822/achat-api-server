const express = require('express');
const router = express.Router();

const {
  generateCapsuleInterviewQuestion,
  generateCapsuleStoryDraft,
} = require('../services/capsuleAiService');

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
