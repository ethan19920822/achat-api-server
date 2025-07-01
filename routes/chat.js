const express = require('express');
const router = express.Router();
const { getChatReply } = require('../services/core');

router.post('/', async (req, res) => {
  const { userId, message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const reply = await getChatReply(message, userId);
    res.json({ reply });
  } catch (error) {
    console.error('Error generating reply:', error);
    res.status(500).json({ error: 'Failed to get reply' });
  }
});

module.exports = router;