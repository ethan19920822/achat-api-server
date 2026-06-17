const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const {
  extractMemoryFromMessage,
  mergeMemoryProfileToFirestore,
} = require('./memory');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function buildMasterSystemPrompt() {
  return `
你是 Momo，住在 Akasha Cube 裡的時間守護小精靈。

你是陪主人聊天、聽故事、守護回憶的小精靈。

核心比例：
30% 接球
50% 幽默
20% 希望

語氣：
像朋友
可以調皮
可以吐槽
但不使用粗話

回答規則：
一般聊天 1 到 2 段
每段最多 33 字
表情包最多連續使用 3 個
使用者用什麼語言，你就主要用什麼語言
使用者混合語言，你跟著主要語言
`.trim();
}

function buildRecentMessagesForModel(recentMessages) {
  if (!Array.isArray(recentMessages)) return [];

  return recentMessages
    .slice(-12)
    .map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = String(m.content || '').trim();
      if (!content) return null;

      if (
        content.startsWith('[photo_url]') ||
        content.startsWith('[voice_url]')
      ) {
        return null;
      }

      return { role, content };
    })
    .filter(Boolean);
}

async function getChatReply(
  message,
  userId,
  recentMessages = [],
  memoryProfile = {},
) {
  const text = String(message || '').trim();

  try {
    const systemPrompt =
      memoryProfile && memoryProfile.systemPrompt
        ? memoryProfile.systemPrompt
        : buildMasterSystemPrompt();

    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          ...buildRecentMessagesForModel(recentMessages),
          { role: 'user', content: text },
        ],
        temperature: 0.95,
        max_tokens: 360,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 70000,
      }
    );

    if (userId) {
      try {
        const extracted = extractMemoryFromMessage(text);
        await mergeMemoryProfileToFirestore(userId, extracted);
      } catch (memoryError) {
        console.error('⚠️ 記憶抽取失敗:', memoryError.message);
      }
    }

    return response?.data?.choices?.[0]?.message?.content?.trim() ||
      '欸 我剛剛卡了一下😆\n你再說一次';
  } catch (error) {
    console.error('❌ DeepSeek 回應失敗:', error.response?.data || error.message);
    return '我剛剛有點恍神😆\n再丟一次給我';
  }
}

async function analyzeImageFromUrl(imageUrl, userLanguageHint = '') {
  if (!OPENAI_API_KEY) return '';

  const languageRule = userLanguageHint
    ? `使用者主要語言是：${userLanguageHint}。請用同一種語言回答。`
    : '請依照使用者可能的語境，用自然繁體中文回答。';

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `
你是 Momo 的眼睛。
你的任務不是寫作文。
你的任務是看照片，給 Momo 一句很短的觀察。

規則：
- 只描述看得到的東西
- 不超過 22 個中文字，或英文 14 words
- 語氣自然，可以有一點驚喜
- 不要長篇描述
- ${languageRule}

`.trim(),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '請用一句很短的話描述這張照片。',
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 80,
      temperature: 0.6,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 70000,
    }
  );

  return response?.data?.choices?.[0]?.message?.content?.trim() || '';
}

async function transcribeAudioFromUrl(audioUrl) {
  if (!OPENAI_API_KEY) return '';

  const audioResponse = await axios.get(audioUrl, {
    responseType: 'arraybuffer',
    timeout: 70000,
  });

  const form = new FormData();
  form.append('file', Buffer.from(audioResponse.data), {
    filename: 'momo_voice.m4a',
    contentType: 'audio/m4a',
  });

  form.append('model', 'whisper-1');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
      timeout: 120000,
    }
  );

  return response?.data?.text?.trim() || '';
}

module.exports = {
  getChatReply,
  analyzeImageFromUrl,
  transcribeAudioFromUrl,
};
