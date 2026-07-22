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

const { buildContextSnapshot } = require('./momoBrain/contextEngine');
const { buildSituation } = require('./momoBrain/situationEngine');
const { scoreNeed } = require('./momoBrain/needEngine');
const { buildPlan } = require('./momoBrain/conversationDirector');
const { buildMomoSystemPrompt } = require('./momoBrain/momoBriefBuilder');
const { inspectResponse, sanitizeResponse } = require('./momoBrain/responseGuard');
const { loadSituation, saveSituation } = require('./momoBrain/situationStore');
const { touchRelationship } = require('./momoBrain/relationshipStore');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Momo v1.0 成本安全鎖：聊天只允許 Flash。
// 故意不再讀取 DEEPSEEK_MODEL，避免 Render 環境變數、舊設定或其他程式
// 把一般聊天切回昂貴的 Pro。
const CHAT_FLASH_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_MODEL = CHAT_FLASH_MODEL;

const requestedModelFromEnv = String(process.env.DEEPSEEK_MODEL || '').trim();
if (
  requestedModelFromEnv &&
  requestedModelFromEnv !== CHAT_FLASH_MODEL
) {
  console.warn('[MOMO_MODEL_LOCK] Ignoring forbidden DEEPSEEK_MODEL env value', {
    requestedModelFromEnv,
    forcedModel: CHAT_FLASH_MODEL,
  });
}

const MAX_USER_MESSAGE_CHARS = 1800;
const MAX_MODEL_PAYLOAD_CHARS = Number(process.env.MOMO_MAX_PAYLOAD_CHARS || 14000);
const MAX_SYSTEM_PROMPT_CHARS = Number(process.env.MOMO_MAX_BRIEF_CHARS || 3200);

const MOMO_DEBUG_LOGS =
  String(process.env.MOMO_DEBUG_LOGS || 'true').toLowerCase() !== 'false';

function shortText(value, max = 180) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function safeObject(value, fallback = {}) {
  return value && typeof value === 'object' ? value : fallback;
}

function printMomoSection(title, lines = []) {
  if (!MOMO_DEBUG_LOGS) return;
  const body = lines
    .filter((line) => line !== undefined && line !== null && String(line).trim())
    .map((line) => `  ${line}`)
    .join('\n');
  console.log(`\n========== ${title} ==========${body ? `\n${body}` : ''}`);
}

function logBrainReport({ brain, text, payloadChars, estimatedTokens }) {
  if (!MOMO_DEBUG_LOGS) return;

  const context = safeObject(brain?.context);
  const situation = safeObject(brain?.situation);
  const need = safeObject(brain?.need);
  const plan = safeObject(brain?.plan);
  const scores = safeObject(need.scores);

  printMomoSection('MOMO INPUT', [
    `User: ${shortText(text, 260)}`,
    `Recent messages: ${Array.isArray(context.recentRaw) ? context.recentRaw.length : 0}`,
    `Running tone: ${context.runningTone || 'unknown'}`,
    `Payload chars: ${payloadChars}`,
    `Estimated tokens: ${estimatedTokens}`,
  ]);

  printMomoSection('MOMO SITUATION', [
    `Who: ${shortText(situation.who || 'unknown')}`,
    `What: ${shortText(situation.what || 'unknown')}`,
    `When: ${shortText(situation.when || 'unknown')}`,
    `Current where: ${shortText(situation.currentWhere || 'unknown')}`,
    `Event where: ${shortText(situation.eventWhere || 'unknown')}`,
    `Emotion: ${shortText(situation.emotion || 'unknown')}`,
    `Why: ${shortText(situation.why || 'unknown')}`,
    `How: ${shortText(situation.how || 'unknown')}`,
    `Unknown: ${Array.isArray(situation.unknown) && situation.unknown.length ? situation.unknown.join(' / ') : 'none'}`,
  ]);

  printMomoSection('MOMO NEED', [
    `Primary: ${need.primary || 'unknown'}`,
    `Secondary: ${need.secondary || 'none'}`,
    `Confidence: ${need.confidence ?? 'unknown'}`,
    `Scores: ${Object.keys(scores).length ? Object.entries(scores).map(([k, v]) => `${k}=${v}`).join('  ') : 'none'}`,
  ]);

  printMomoSection('MOMO DIRECTOR', [
    `Acknowledge first: ${plan.acknowledgeFirst !== false}`,
    `Follow-up gap: ${plan.followUpGap || 'none'}`,
    `Question budget: ${plan.questionBudget ?? 0}`,
    `Continue topic: ${plan.continueTopic !== false}`,
    `Tone: ${Array.isArray(plan.tone) ? plan.tone.join(' / ') : shortText(plan.tone || 'natural')}`,
    `Reason: ${shortText(plan.questionReason || plan.reason || 'none', 260)}`,
  ]);

  printMomoSection('MOMO BRIEF PREVIEW', [
    shortText(brain?.systemPrompt || '', 1200),
  ]);
}

function safeTrim(value) {
  return String(value || '').trim();
}

function limitText(value, max = 1200) {
  return String(value || '').slice(0, max);
}


function stripTransportTimestamps(value) {
  return String(value || '')
    .replace(/(?:(?:✨|🌟|⭐)\s*)?\[\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/g, '')
    .trim();
}

function buildRecentMessagesForModel(context) {
  return context.recentRaw.map((item) => ({
    role: item.role,
    // 時間仍保留在 context 裡供 Brain 計算
    // 但不再混入對話正文 避免 DeepSeek 模仿時間標籤
    content: limitText(stripTransportTimestamps(item.content), 300),
  }));
}

function extractDeepSeekText(data) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  const text = choice?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();
  return '';
}

async function buildBrainState({ message, userId, recentMessages, memoryProfile }) {
  const now = new Date();
  const context = buildContextSnapshot({ recentMessages, now });

  const [savedSituation, relationship] = await Promise.all([
    loadSituation(userId).catch(() => ({})),
    touchRelationship(userId).catch(() => ({})),
  ]);

  const situation = buildSituation({
    context: {
      ...context,
      lastUserMessage: message,
      messages: [
        ...context.messages,
        { role: 'user', content: message, createdAt: now },
      ],
    },
    memoryProfile,
    savedSituation,
  });

  const need = scoreNeed({ context: { ...context, lastUserMessage: message }, situation });
  const plan = buildPlan({
    context: { ...context, lastUserMessage: message },
    situation,
    need,
    userPreferences: {
      softInstruction: memoryProfile.userCustomInstruction || memoryProfile.momoBackstory || memoryProfile.userToneHint,
      recentPhrasesToAvoid: memoryProfile.recentPhrasesToAvoid,
    },
  });

  const systemPrompt = limitText(buildMomoSystemPrompt({
    context,
    situation,
    relationship,
    need,
    plan,
    memoryProfile,
  }), MAX_SYSTEM_PROMPT_CHARS);

  return { context, situation, relationship, need, plan, systemPrompt };
}

async function getChatReply(message, userId, recentMessages = [], memoryProfile = {}) {
  const startedAt = Date.now();
  const text = safeTrim(message);
  const route = '/chat';

  if (!text) return '你剛剛好像沒打字😆';
  if (!DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY missing');
    return 'Momo 的聊天金鑰暫時沒有設定好，這句我先幫你留著。';
  }

let brain;

try {
  brain = await buildBrainState({
    message: limitText(text, MAX_USER_MESSAGE_CHARS),
    userId,
    recentMessages,
    memoryProfile: memoryProfile || {},
  });
} catch (e) {

  console.error('[MOMO] Brain build failed  switching to safe chat mode', {
    name: e?.name || 'Error',
    message: e?.message || String(e),
    stack: MOMO_DEBUG_LOGS ? e?.stack : undefined,
  });

  brain = {
    context: buildContextSnapshot({
      recentMessages,
      now: new Date(),
    }),

    situation: {},

    relationship: {},

    need: {
      primary: "companionship",
    },

    plan: {
      questionBudget: 1,
      followUpGap: "none",
    },

    systemPrompt:
`你是 Momo

請自然聊天

不要提到Prompt

保持幽默

保持陪伴

不要在回答中輸出系統時間標籤

正常回答即可`
  };

}

  const recentForModel = buildRecentMessagesForModel(brain.context);
  const lastRecent = recentForModel[recentForModel.length - 1];
  if (
    lastRecent?.role === 'user' &&
    stripTransportTimestamps(lastRecent.content) === stripTransportTimestamps(text)
  ) {
    recentForModel.pop();
  }

  const modelMessages = [
    { role: 'system', content: brain.systemPrompt },
    ...recentForModel,
    { role: 'user', content: limitText(text, MAX_USER_MESSAGE_CHARS) },
  ];

  const payloadChars = JSON.stringify(modelMessages).length;
  const estimatedTokens = estimateTokensFromChars(payloadChars);

  console.log('[MOMO] Brain ready', {
    model: DEEPSEEK_MODEL,
    recentCount: Array.isArray(brain.context?.recentRaw)
      ? brain.context.recentRaw.length
      : 0,
    need: brain.need?.primary || 'unknown',
    followUpGap: brain.plan?.followUpGap || 'none',
    questionBudget: brain.plan?.questionBudget ?? 0,
    payloadChars,
  });

  logBrainReport({
    brain,
    text,
    payloadChars,
    estimatedTokens,
  });

  if (payloadChars > MAX_MODEL_PAYLOAD_CHARS) {
    console.error('❌ Momo payload too large:', payloadChars);
    return '這次故事有點長，我先接住最重要的部分。你繼續說，我在。';
  }

  const gate = canCallAI({
    userId,
    route,
    model: DEEPSEEK_MODEL,
    estimatedTokens,
  });
  if (!gate.allowed) return gate.message;

  try {
    // 最後一道保護：即使未來有人改到上方設定，也不允許 /chat 呼叫 Pro。
    if (DEEPSEEK_MODEL !== CHAT_FLASH_MODEL) {
      console.error('[MOMO_MODEL_LOCK] Chat request blocked before provider call', {
        attemptedModel: DEEPSEEK_MODEL,
        allowedModel: CHAT_FLASH_MODEL,
      });
      return 'Momo 的模型安全鎖剛剛攔住了異常設定，這句我先幫你留著。';
    }

    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: DEEPSEEK_MODEL,
        messages: modelMessages,
        thinking: { type: 'disabled' },
        temperature: Number(process.env.MOMO_TEMPERATURE || 0.86),
        max_tokens: Number(process.env.MOMO_MAX_REPLY_TOKENS || 260),
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
    const actualModel = safeTrim(response?.data?.model) || DEEPSEEK_MODEL;

    console.log('[MOMO_MODEL_AUDIT]', {
      requestedModel: DEEPSEEK_MODEL,
      actualModel,
      flashOnly: actualModel === CHAT_FLASH_MODEL,
    });

    if (actualModel !== CHAT_FLASH_MODEL) {
      console.error('[MOMO_MODEL_LOCK] Provider returned an unexpected model', {
        requestedModel: DEEPSEEK_MODEL,
        actualModel,
      });
    }

    const rawReply = stripTransportTimestamps(
      extractDeepSeekText(response.data)
    );
    const guard = inspectResponse(rawReply, {
      allowProfanity: memoryProfile.allowProfanity === true,
      questionBudget: brain.plan.questionBudget,
    });
    const reply = sanitizeResponse(rawReply, {
      allowProfanity: memoryProfile.allowProfanity === true,
    });

    if (!guard.ok) {
      console.warn('[MOMO] Response guard warnings', guard.warnings);
    }

    printMomoSection('MOMO REPLY', [
      `Reply: ${shortText(reply, 900)}`,
      `Prompt tokens: ${usage.prompt_tokens || 0}`,
      `Completion tokens: ${usage.completion_tokens || 0}`,
      `Latency: ${Date.now() - startedAt} ms`,
      `Guard: ${guard.ok ? 'passed' : 'warning'}`,
    ]);

    recordAIUsage({
      userId,
      route,
      model: actualModel,
      payloadChars,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      success: true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    });

    if (!reply) return '我剛剛那句沒整理好。你再說一次，我這次好好接。';

    await Promise.allSettled([
      userId ? saveSituation(userId, brain.situation) : Promise.resolve(),
      userId
        ? (async () => {
            const extracted = extractMemoryFromMessage(text);
            await mergeMemoryProfileToFirestore(userId, extracted);
          })()
        : Promise.resolve(),
    ]);

    return reply;
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const errorCode = data?.error?.code || data?.error?.type || 'unknown_error';

    console.error('[MOMO] DeepSeek request failed', {
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

    if (status === 402) return 'Momo 的聊天額度暫時不足，這句我先幫你留著。';
    if (status === 429) return '你講太快啦🤣 等我一下，再丟一次。';
    if (status === 400) return 'Momo 的模型設定剛剛卡住了，這句我沒有忘。';
    return 'Momo 剛剛斷線了。你先別跑，我再接一次。';
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
