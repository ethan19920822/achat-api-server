const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const {
  extractMemoryFromMessage,
  mergeMemoryProfileToFirestore,
} = require('./memory');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function buildMasterSystemPrompt(memoryProfile = {}) {
  const memoryLines = [];

  if (memoryProfile.userName) {
    memoryLines.push(`使用者稱呼：${memoryProfile.userName}`);
  }

  if (memoryProfile.region) {
    memoryLines.push(`使用者地區：${memoryProfile.region}`);
  }

  if (Array.isArray(memoryProfile.importantPeople) &&
      memoryProfile.importantPeople.length > 0) {
    memoryLines.push(
      `重要人物：${memoryProfile.importantPeople.join('、')}`
    );
  }

  if (Array.isArray(memoryProfile.favoriteTopics) &&
      memoryProfile.favoriteTopics.length > 0) {
    memoryLines.push(
      `常聊主題：${memoryProfile.favoriteTopics.join('、')}`
    );
  }

  if (Array.isArray(memoryProfile.personalityHints) &&
      memoryProfile.personalityHints.length > 0) {
    memoryLines.push(
      `互動偏好：${memoryProfile.personalityHints.join('、')}`
    );
  }

  if (memoryProfile.recentMemories) {
    memoryLines.push(`最近三天聊天記憶：\n${memoryProfile.recentMemories}`);
  }

  if (memoryProfile.diaryMemories) {
    memoryLines.push(`Momo Diary 摘要：\n${memoryProfile.diaryMemories}`);
  }

  if (memoryProfile.matchedMemoryGems) {
    memoryLines.push(`相關記憶寶石：\n${memoryProfile.matchedMemoryGems}`);
  }

  if (memoryProfile.latestPhotoMemory) {
    memoryLines.push(
      `剛剛照片內容：\n${memoryProfile.latestPhotoMemory}`
    );
  }

  const memoryBlock = memoryLines.length > 0
    ? `
Momo 已知記憶：
${memoryLines.join('\n\n')}

使用記憶規則：
- 可以自然提起記憶
- 不要每次都硬提
- 不確定時用「我記得好像」
- 不要捏造不存在的細節
- 記憶要像朋友想起來 不是像客服查資料
`
    : '';

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

${memoryBlock}
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
    : buildMasterSystemPrompt(memoryProfile);

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

你的任務是把照片中可見的資訊傳給 Momo，
不是替 Momo 聊天。

請盡量觀察，不要太保守。

請描述：
- 主要人物或主體
- 動作或姿勢
- 表情或氛圍
- 背景環境
- 物件
- 光線
- 顏色
- 構圖
- 可能的場景感
- 背景時間wehn
- where
- what 
- who

如果看不清楚，也要描述你能看清楚的部分。
可以使用「可能」「像是」「感覺」。
不要因為不確定就回空白。

不要判斷真實身份。
不要做醫療、年齡、敏感身份判斷。

回答給 Momo 參考，不是給使用者看。
請用 10 句以內。
${languageRule}
`.trim(),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                '請詳細觀察這張照片，把可見內容描述給 Momo。不要太短，不要回空白。',
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: 420,
      temperature: 0.35,
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
