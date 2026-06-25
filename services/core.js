const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const {
  extractMemoryFromMessage,
  mergeMemoryProfileToFirestore,
} = require('./memory');

const {
  canCallAI,
  recordAIUsage,
  estimateTokensFromChars,
} = require('./aiUsageMonitor');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const MAX_SYSTEM_PROMPT_CHARS = 1800;
const MAX_USER_MESSAGE_CHARS = 1800;
const MAX_MODEL_PAYLOAD_CHARS = 9000;

function limitText(value, max = 1200) {
  return String(value || '').slice(0, max);
}

function safeTrim(value) {
  return String(value || '').trim();
}

function buildMasterSystemPrompt(memoryProfile = {}) {
  const memoryLines = [];

  if (memoryProfile.userName) memoryLines.push(`使用者稱呼：${memoryProfile.userName}`);
  if (memoryProfile.region) memoryLines.push(`使用者地區：${memoryProfile.region}`);

  if (Array.isArray(memoryProfile.importantPeople) && memoryProfile.importantPeople.length > 0) {
    memoryLines.push(`重要人物：${memoryProfile.importantPeople.slice(0, 8).join('、')}`);
  }

  if (Array.isArray(memoryProfile.favoriteTopics) && memoryProfile.favoriteTopics.length > 0) {
    memoryLines.push(`常聊主題：${memoryProfile.favoriteTopics.slice(0, 8).join('、')}`);
  }

  if (Array.isArray(memoryProfile.personalityHints) && memoryProfile.personalityHints.length > 0) {
    memoryLines.push(`互動偏好：${memoryProfile.personalityHints.slice(0, 8).join('、')}`);
  }

  if (memoryProfile.recentMemories) {
    memoryLines.push(`最近三天聊天記憶：\n${limitText(memoryProfile.recentMemories, 700)}`);
  }

  if (memoryProfile.diaryMemories) {
    memoryLines.push(`Momo Diary 摘要：\n${limitText(memoryProfile.diaryMemories, 700)}`);
  }

  if (memoryProfile.matchedMemoryGems) {
    memoryLines.push(`相關記憶寶石：\n${limitText(memoryProfile.matchedMemoryGems, 700)}`);
  }

  if (memoryProfile.latestPhotoMemory) {
    memoryLines.push(`剛剛照片內容：\n${limitText(memoryProfile.latestPhotoMemory, 700)}`);
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
    .slice(-8)
    .map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = safeTrim(m.content || m.text);

      if (!content) return null;

      if (
        content.startsWith('[photo_url]') ||
        content.startsWith('[voice_url]') ||
        content.startsWith('[video_url]')
      ) {
        return null;
      }

      return {
        role,
        content: limitText(content, 500),
      };
    })
    .filter(Boolean);
}

function compactMemoryProfile(memoryProfile = {}) {
  return {
    userName: memoryProfile.userName,
    region: memoryProfile.region,
    importantPeople: Array.isArray(memoryProfile.importantPeople)
      ? memoryProfile.importantPeople.slice(0, 8)
      : [],
    favoriteTopics: Array.isArray(memoryProfile.favoriteTopics)
      ? memoryProfile.favoriteTopics.slice(0, 8)
      : [],
    personalityHints: Array.isArray(memoryProfile.personalityHints)
      ? memoryProfile.personalityHints.slice(0, 8)
      : [],
    recentMemories: limitText(memoryProfile.recentMemories, 700),
    diaryMemories: limitText(memoryProfile.diaryMemories, 700),
    matchedMemoryGems: limitText(memoryProfile.matchedMemoryGems, 700),
    latestPhotoMemory: limitText(memoryProfile.latestPhotoMemory, 700),
    systemPrompt: memoryProfile.systemPrompt
      ? limitText(memoryProfile.systemPrompt, MAX_SYSTEM_PROMPT_CHARS)
      : '',
  };
}

function buildModelMessages(message, recentMessages = [], memoryProfile = {}) {
  const compactProfile = compactMemoryProfile(memoryProfile);

  const systemPrompt = limitText(
    compactProfile.systemPrompt || buildMasterSystemPrompt(compactProfile),
    MAX_SYSTEM_PROMPT_CHARS
  );

  const userText = limitText(message, MAX_USER_MESSAGE_CHARS);

  return [
    { role: 'system', content: systemPrompt },
    ...buildRecentMessagesForModel(recentMessages),
    { role: 'user', content: userText },
  ];
}

function extractDeepSeekText(data) {
  const choice = data?.choices?.[0];

  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  const text = choice?.text;
  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  return '';
}

async function getChatReply(
  message,
  userId,
  recentMessages = [],
  memoryProfile = {}
) {
  const startedAt = Date.now();
  const text = safeTrim(message);
  const route = '/chat';

  if (!text) return '你剛剛好像沒打字😆';

  if (!DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY missing');
    return 'AI 金鑰暫時沒有設定好，膠囊內容已先保留。';
  }

  const modelMessages = buildModelMessages(text, recentMessages, memoryProfile);
  const payloadChars = JSON.stringify(modelMessages).length;
  const estimatedTokens = estimateTokensFromChars(payloadChars);

  console.log('Momo model:', DEEPSEEK_MODEL);
  console.log('Momo messages count:', modelMessages.length);
  console.log('Momo payload chars:', payloadChars);

  if (payloadChars > MAX_MODEL_PAYLOAD_CHARS) {
    console.error('❌ Momo payload too large, blocked:', payloadChars);
    return '這次內容太長，我先幫你保留重點，晚點再整理成膠囊。';
  }

  const gate = canCallAI({
    userId,
    route,
    model: DEEPSEEK_MODEL,
    estimatedTokens,
  });

  if (!gate.allowed) return gate.message;

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: DEEPSEEK_MODEL,
        messages: modelMessages,
        temperature: 0.8,
        max_tokens: 120,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 70000,
      }
    );

    const usage = response?.data?.usage || {};
    const choice = response?.data?.choices?.[0];

    console.log('[AI_RESPONSE]', {
      model: DEEPSEEK_MODEL,
      status: response.status,
      finishReason: choice?.finish_reason,
      hasContent: !!choice?.message?.content,
      contentPreview: String(choice?.message?.content || '').slice(0, 80),
      usage,
    });

    recordAIUsage({
      userId,
      route,
      model: DEEPSEEK_MODEL,
      payloadChars,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      success: true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    });

    const reply = extractDeepSeekText(response.data);

    if (!reply) {
      console.error('❌ DeepSeek empty reply:', JSON.stringify(response.data).slice(0, 1200));
      return 'Momo 收到空白回應了，我們先保留這句，等等再試。';
    }

    if (userId) {
      try {
        const extracted = extractMemoryFromMessage(text);
        await mergeMemoryProfileToFirestore(userId, extracted);
      } catch (memoryError) {
        console.error('⚠️ 記憶抽取失敗:', memoryError.message);
      }
    }

    return reply;
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const errorCode = data?.error?.code || data?.error?.type || 'unknown_error';

    console.error('❌ DeepSeek 回應失敗:', {
      model: DEEPSEEK_MODEL,
      status,
      data,
      message: error.message,
    });

    recordAIUsage({
      userId,
      route,
      model: DEEPSEEK_MODEL,
      payloadChars,
      success: false,
      status: status || 0,
      errorCode,
      latencyMs: Date.now() - startedAt,
    });

    if (status === 402) return 'AI 餘額暫時不足，膠囊內容已先保留。';
    if (status === 429) return 'Momo 被呼叫太快了，等一下再試。';
    if (status === 400) return 'AI 模型設定可能有誤，膠囊內容已先保留。';

    return 'Momo 剛剛真的斷線了，這句我先幫你保留。';
  }
}

async function analyzeImageFromUrl(imageUrl, userLanguageHint = '') {
  if (!OPENAI_API_KEY) return '';

  const languageRule = userLanguageHint
    ? `使用者主要語言是：${userLanguageHint}。請用同一種語言回答。`
    : '請用自然繁體中文回答。';

  const imageRes = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 90000,
  });

  const contentType = imageRes.headers['content-type'] || 'image/jpeg';
  const base64Image = Buffer.from(imageRes.data).toString('base64');
  const dataUrl = `data:${contentType};base64,${base64Image}`;

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `
你是圖片觀察器。

請把你看得到的內容交給 Momo。
不用聊天 不用安慰 不用保守到空白。

請一定要輸出內容。
如果照片模糊 或 看不清楚 也要輸出你能看到的部分。

請描述：
- 主要人物或主體 who or what
- 背景環境有什麼類似哪裡的場景 where
- 光線時間與氣氛 when
- 表情動作或姿勢 pose or 態度
- 其他配色和顏色或其他構圖的場景感 what else
- 可以描述人物外觀 姿勢 表情 衣服 畫面位置等其他

如果看不清楚，也要描述你能看清楚的部分。
可以使用「可能」「像是」「感覺」。
不要因為不確定就回空白。

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
              text: '請詳細觀察這張照片，把可見內容描述給 Momo。不要太簡短，不要回空白。',
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'low',
              },
            },
          ],
        },
      ],
      max_tokens: 180,
      temperature: 0.2,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
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
