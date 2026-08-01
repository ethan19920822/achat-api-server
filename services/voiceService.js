const axios = require('axios');

const ELEVENLABS_API_KEY = String(process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_MODEL_ID = String(process.env.ELEVENLABS_MODEL_ID || 'eleven_v3').trim();
const ELEVENLABS_VOICE_ID = String(process.env.ELEVENLABS_VOICE_ID || '').trim();

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const MAX_VOICE_TEXT_CHARS = Number(process.env.ELEVENLABS_MAX_TEXT_CHARS || 500);
const REQUEST_TIMEOUT_MS = Number(process.env.ELEVENLABS_TIMEOUT_MS || 90000);

function cleanVoiceText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function assertVoiceConfig() {
  const missing = [];

  if (!ELEVENLABS_API_KEY) missing.push('ELEVENLABS_API_KEY');
  if (!ELEVENLABS_MODEL_ID) missing.push('ELEVENLABS_MODEL_ID');
  if (!ELEVENLABS_VOICE_ID) missing.push('ELEVENLABS_VOICE_ID');

  if (missing.length > 0) {
    const error = new Error(
      `Missing ElevenLabs environment variables: ${missing.join(', ')}`,
    );
    error.code = 'ELEVENLABS_CONFIG_MISSING';
    error.status = 503;
    throw error;
  }
}

function extractProviderError(error) {
  const data = error?.response?.data;

  if (Buffer.isBuffer(data)) {
    try {
      return JSON.parse(data.toString('utf8'));
    } catch (_) {
      return data.toString('utf8').slice(0, 800);
    }
  }

  return data || error?.message || 'Unknown ElevenLabs error';
}

async function generateAkashaVoice(
  text,
  { outputFormat = DEFAULT_OUTPUT_FORMAT } = {},
) {
  assertVoiceConfig();

  const cleanText = cleanVoiceText(text);

  if (!cleanText) {
    const error = new Error('Voice text is required');
    error.code = 'VOICE_TEXT_REQUIRED';
    error.status = 400;
    throw error;
  }

  if (cleanText.length > MAX_VOICE_TEXT_CHARS) {
    const error = new Error(
      `Voice text exceeds ${MAX_VOICE_TEXT_CHARS} characters`,
    );
    error.code = 'VOICE_TEXT_TOO_LONG';
    error.status = 400;
    throw error;
  }

  const startedAt = Date.now();
  const endpoint =
    `${ELEVENLABS_BASE_URL}/text-to-speech/` +
    `${encodeURIComponent(ELEVENLABS_VOICE_ID)}` +
    `?output_format=${encodeURIComponent(outputFormat)}`;

  try {
    const response = await axios.post(
      endpoint,
      {
        text: cleanText,
        model_id: ELEVENLABS_MODEL_ID,
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
        timeout: REQUEST_TIMEOUT_MS,
        maxContentLength: 12 * 1024 * 1024,
        maxBodyLength: 12 * 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 300,
      },
    );

    const audioBuffer = Buffer.from(response.data);

    if (audioBuffer.length === 0) {
      const error = new Error('ElevenLabs returned an empty audio file');
      error.code = 'ELEVENLABS_EMPTY_AUDIO';
      error.status = 502;
      throw error;
    }

    return {
      buffer: audioBuffer,
      contentType: response.headers['content-type'] || 'audio/mpeg',
      outputFormat,
      modelId: ELEVENLABS_MODEL_ID,
      voiceId: ELEVENLABS_VOICE_ID,
      textChars: cleanText.length,
      audioBytes: audioBuffer.length,
      latencyMs: Date.now() - startedAt,
      requestId:
        response.headers['request-id'] ||
        response.headers['x-request-id'] ||
        '',
    };
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      const timeoutError = new Error('ElevenLabs request timed out');
      timeoutError.code = 'ELEVENLABS_TIMEOUT';
      timeoutError.status = 504;
      timeoutError.providerData = extractProviderError(error);
      throw timeoutError;
    }

    if (error.status && !error.response) {
      throw error;
    }

    const providerError = new Error('ElevenLabs voice generation failed');
    providerError.code = 'ELEVENLABS_REQUEST_FAILED';
    providerError.status = error?.response?.status || 502;
    providerError.providerData = extractProviderError(error);
    throw providerError;
  }
}

module.exports = {
  generateAkashaVoice,
  cleanVoiceText,
  assertVoiceConfig,
};
