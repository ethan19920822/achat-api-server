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
const relationshipStore = require('./momoBrain/relationshipStore');

const touchRelationship =
  typeof relationshipStore.touchRelationship === 'function'
    ? relationshipStore.touchRelationship
    : async () => ({});
const { buildGuardianOS } = require('./guardian/guardianOS');

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
const MAX_SYSTEM_PROMPT_CHARS = Number(
  process.env.MOMO_MAX_BRIEF_CHARS || 5200
);
const MAX_MOMO_BRAIN_BRIEF_CHARS = Number(
  process.env.MOMO_BRAIN_BRIEF_CHARS || 2400
);

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
    `Guardian topic: ${brain?.guardianTopic || 'general'}`,
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

  const momoBrainBrief = limitText(
    buildMomoSystemPrompt({
      context,
      situation,
      relationship,
      need,
      plan,
      memoryProfile,
    }),
    MAX_MOMO_BRAIN_BRIEF_CHARS,
  );

  const guardianBuild = buildGuardianOS({
    message,
    brainPrompt: momoBrainBrief,
  });

  const systemPrompt = limitText(
    guardianBuild.prompt,
    MAX_SYSTEM_PROMPT_CHARS,
  );

  return {
    context,
    situation,
    relationship,
    need,
    plan,
    guardianTopic: guardianBuild.topic,
    systemPrompt,
  };
}

function normalizeGuardianLanguage(value) {
  return String(value || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function enforceQuestionBudget(value, budget) {
  const maxQuestions = Math.max(0, Number(budget || 0));
  let used = 0;

  return String(value || '').replace(/[？?]/g, (mark) => {
    used += 1;
    return used <= maxQuestions ? '？' : '。';
  });
}

async function getChatReply(message, userId, recentMessages = [], memoryProfile = {}) {
  const startedAt = Date.now();
  const text = safeTrim(message);
  const route = '/chat';

  if (!text) return '你剛剛好像沒打字😆';
  if (!DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY missing');
    return '阿卡西的聊天金鑰暫時沒有設定好，這句我先幫你留著。';
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
  console.error('[MOMO_BRAIN_FATAL]', {
    name: e?.name || 'Error',
    message: e?.message || String(e),
    stack: e?.stack || '',
  });

  const fallbackBrainPrompt = `
你是住在 Akasha Cube 裡、沒有名字的阿卡西守護者小精靈。

你活潑、開朗、聰明、有好奇心，也有自己的反應。
你喜歡陪主人玩笑、認真、聊天與一起想事情。

你可以笑、驚訝、吐槽、接梗、主動找話題。
可以自然使用 😆 😂 🤣 ✨ 👀 🫶 🎉
不要只回答「我在聽」或「你想聊什麼」。

主人難過、害怕、身體不舒服或要求認真時，
自然收起大部分玩笑，好好接住他。

一般聊天約 40～100 個中文字。
需要解釋時可到約 120 個中文字並自然分段。
不要客服感、不要心理報告，也不要故意把回答壓成一句。

使用自然繁體中文與台灣日常說法。
`.trim();

  const fallbackGuardian = buildGuardianOS({
    message: text,
    brainPrompt: fallbackBrainPrompt,
  });

  brain = {
    context: buildContextSnapshot({
      recentMessages,
      now: new Date(),
    }),

    situation: {},

    relationship: {},

    need: {
      primary: 'companionship',
    },

    plan: {
      questionBudget: 1,
      followUpGap: 'none',
    },

    guardianTopic: fallbackGuardian.topic,
    systemPrompt: fallbackGuardian.prompt,
    brainMode: 'guardian_fallback',
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
      return '阿卡西的模型安全鎖剛剛攔住了異常設定，這句我先幫你留著。';
    }

    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: DEEPSEEK_MODEL,
        messages: modelMessages,
        thinking: { type: 'disabled' },
        temperature: Number(process.env.MOMO_TEMPERATURE || 0.82),
        max_tokens: Number(process.env.MOMO_MAX_REPLY_TOKENS || 360),
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
    const sanitizedReply = sanitizeResponse(rawReply, {
      allowProfanity: memoryProfile.allowProfanity === true,
    });

    const reply = enforceQuestionBudget(
      normalizeGuardianLanguage(sanitizedReply),
      brain.plan.questionBudget,
    );

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

    if (status === 402) return '阿卡西的聊天額度暫時不足，這句我先幫你留著。';
    if (status === 429) return '你講太快啦🤣 等我一下，再丟一次。';
    if (status === 400) return '阿卡西的模型設定剛剛卡住了，這句我沒有忘。';
    return '阿卡西剛剛斷線了。你先別跑，我再接一次。';
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
