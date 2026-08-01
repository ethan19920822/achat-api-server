console.log("✅ voice.js imported");
const express = require('express');

const {
  generateAkashaVoice,
  cleanVoiceText,
} = require('../services/voiceService');

const router = express.Router();

const MAX_TEST_TEXT_CHARS = Number(
  process.env.ELEVENLABS_MAX_TEXT_CHARS || 500,
);

function safeHeaderValue(value) {
  return String(value || '')
    .replace(/[\r\n]/g, '')
    .slice(0, 200);
}

function isAuthorizedTestRequest(req) {
  const expectedKey = String(process.env.DRIFT_ADMIN_KEY || '').trim();

  if (!expectedKey) {
    return process.env.NODE_ENV !== 'production';
  }

  const suppliedKey = String(
    req.get('x-admin-key') ||
    req.get('x-drift-admin-key') ||
    '',
  ).trim();

  return suppliedKey === expectedKey;
}

router.post('/test', async (req, res) => {
  console.log("🔥 /voice/test hit");
  if (!isAuthorizedTestRequest(req)) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid voice test admin key',
    });
  }

  const text = cleanVoiceText(req.body?.text);

  if (!text) {
    return res.status(400).json({
      error: 'voice_text_required',
      message: 'text is required',
    });
  }

  if (text.length > MAX_TEST_TEXT_CHARS) {
    return res.status(400).json({
      error: 'voice_text_too_long',
      message: `text must be ${MAX_TEST_TEXT_CHARS} characters or fewer`,
    });
  }

  try {
    const audio = await generateAkashaVoice(text);

    res.set({
      'Content-Type': audio.contentType,
      'Content-Length': String(audio.buffer.length),
      'Content-Disposition': 'inline; filename="akasha-voice-test.mp3"',
      'Cache-Control': 'no-store',
      'X-Akasha-Voice-Model': safeHeaderValue(audio.modelId),
      'X-Akasha-Text-Chars': String(audio.textChars),
      'X-Akasha-Audio-Bytes': String(audio.audioBytes),
      'X-Akasha-Latency-Ms': String(audio.latencyMs),
      ...(audio.requestId
        ? { 'X-ElevenLabs-Request-Id': safeHeaderValue(audio.requestId) }
        : {}),
    });

    return res.status(200).send(audio.buffer);
  } catch (error) {
    console.error('[AKASHA_VOICE] Test generation failed', {
      code: error.code,
      status: error.status,
      message: error.message,
      providerData: error.providerData,
    });

    return res.status(error.status || 500).json({
      error: error.code || 'voice_generation_failed',
      message:
        error.status === 401
          ? 'ElevenLabs API key was rejected'
          : error.status === 429
            ? 'ElevenLabs usage limit was reached'
            : error.status === 503
              ? 'ElevenLabs environment variables are incomplete'
              : 'Akasha voice generation failed',
    });
  }
});


module.exports = router;
