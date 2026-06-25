const axios = require('axios');
require('dotenv').config();

const {
  canCallAI,
  recordAIUsage,
  estimateTokensFromChars,
} = require('./aiUsageMonitor');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const MAX_MEMORY_CHARS = 1200;
const MAX_DIARY_CHARS = 900;
const MAX_SPARK_CHARS = 900;
const MAX_MESSAGE_CHARS = 260;
const MAX_INTERVIEW_MESSAGES = 6;
const MAX_PAYLOAD_CHARS = 9000;

function safeText(value) {
  return String(value || '').trim();
}

function clampText(value, max = 1000) {
  const clean = safeText(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}...`;
}

function compactMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((m) => ({
      role: safeText(m.role || m.type || ''),
      text: clampText(m.text || m.content || '', MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.text.length > 0)
    .slice(-MAX_INTERVIEW_MESSAGES);
}

function compactMemoryContext(memoryContext = {}) {
  if (!memoryContext || typeof memoryContext !== 'object') return {};

  return {
    source: safeText(memoryContext.source),
    sparkTitle: clampText(memoryContext.sparkTitle, 120),
    sparkExcerpt: clampText(memoryContext.sparkExcerpt, MAX_SPARK_CHARS),
    draftMode: safeText(memoryContext.draftMode),
    originalStory: clampText(memoryContext.originalStory, MAX_MEMORY_CHARS),
  };
}

function sourceLabel(body) {
  const source = safeText(body.source || body.memoryContext?.source);

  if (source === 'momo_memory_spark') return 'Momo Memory Spark from chat';
  if (source === 'momo_diary' || source === 'momo_chat') {
    return 'Momo Diary / Momo chat memory';
  }

  if (safeText(body.photoUrl)) return 'photo memory';
  if (safeText(body.videoUrl)) return 'video memory';
  if (safeText(body.audioUrl)) return 'voice memory';

  return `${safeText(body.inputType) || 'text'} memory`;
}

function isMomoSpark(body) {
  return safeText(body.source || body.memoryContext?.source) === 'momo_memory_spark';
}

function isMomoDiary(body) {
  const source = safeText(body.source || body.memoryContext?.source);
  return source === 'momo_diary' || source === 'momo_chat';
}

function styleGuide(style) {
  switch (style) {
    case 'voice_script':
      return `
Write like the user is speaking directly to the future recipient.
Natural, warm, slightly imperfect.
Avoid essay tone.
`.trim();

    case 'poetic_capsule':
      return `
Write with gentle poetic rhythm.
Use images and pauses, but do not become too abstract.
Keep emotional truth clear.
`.trim();

    case 'gentle_letter':
    default:
      return `
Write like a sincere future letter.
Soft, human, intimate, but not overly dramatic.
`.trim();
  }
}

function buildCompactMemoryBrief(body) {
  const context = compactMemoryContext(body.memoryContext || {});
  const photoCount = Array.isArray(body.diaryPhotoUrls)
    ? body.diaryPhotoUrls.length
    : 0;

  return `
Memory source: ${sourceLabel(body)}
Source key: ${safeText(body.source || context.source)}
Input type: ${safeText(body.inputType)}

Raw memory:
${clampText(body.rawText, MAX_MEMORY_CHARS)}

Momo Spark title:
${context.sparkTitle}

Momo Spark excerpt:
${context.sparkExcerpt}

Diary title:
${clampText(body.diaryTitle, 180)}

Diary story draft:
${clampText(body.diaryStoryDraft, MAX_DIARY_CHARS)}

Attached media:
Photo exists: ${safeText(body.photoUrl) ? 'yes' : 'no'}
Video exists: ${safeText(body.videoUrl) ? 'yes' : 'no'}
Audio exists: ${safeText(body.audioUrl) ? 'yes' : 'no'}
Diary photo count: ${photoCount}

Draft mode:
${safeText(body.draftMode || context.draftMode)}
`.trim();
}

function momoSparkInterviewRule() {
  return `
Special rule for Momo Memory Spark:
- This memory came from a natural chat with Momo.
- Momo is not a therapist or a data assistant.
- Momo is a time guardian spirit who found a spark worth saving.
- Ask like Momo is gently helping the user shape the spark.
- Do not force the user to analyze emotions.
- Do not ask broad questions like 「你現在感覺如何？」
- Ask one small question that helps decide what this capsule should preserve.
`.trim();
}

function momoSparkStoryRule() {
  return `
Special rule for Momo Memory Spark:
- This draft started from a natural chat.
- Keep the user's raw wording and life texture.
- Do not turn it into a polished essay.
- Do not merge unrelated life topics into one fake theme.
- It is okay if the draft feels like a time-period capsule instead of a single event.
- The draft should feel like something the user can edit, not a finished official letter.
- Write in first person.
- Preserve uncertainty if the user sounded uncertain.
`.trim();
}

function extractDeepSeekText(data) {
  const choice = data?.choices?.[0];

  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();

  const text = choice?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();

  return '';
}

async function callDeepSeek({
  route,
  userId,
  system,
  prompt,
  maxTokens = 160,
  temperature = 0.75,
}) {
  const startedAt = Date.now();

  if (!DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY missing');
    return '';
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];

  const payloadChars = JSON.stringify(messages).length;
  const estimatedTokens = estimateTokensFromChars(payloadChars);

  console.log('[CAPSULE_AI_REQUEST]', {
    route,
    model: DEEPSEEK_MODEL,
    mode: 'non-thinking',
    payloadChars,
    estimatedTokens,
  });

  if (payloadChars > MAX_PAYLOAD_CHARS) {
    console.error('❌ Capsule AI payload too large, blocked:', {
      route,
      payloadChars,
    });
    return '';
  }

  const gate = canCallAI({
    userId,
    route,
    model: DEEPSEEK_MODEL,
    estimatedTokens,
  });

  if (!gate.allowed) {
    console.error('[CAPSULE_AI_BLOCKED]', {
      route,
      reason: gate.reason,
    });
    return gate.message || '';
  }

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: DEEPSEEK_MODEL,
        messages,
        thinking: {
          type: 'disabled',
        },
        temperature,
        max_tokens: maxTokens,
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

    console.log('[CAPSULE_AI_RESPONSE]', {
      route,
      model: DEEPSEEK_MODEL,
      mode: 'non-thinking',
      status: response.status,
      finishReason: choice?.finish_reason,
      hasContent: !!choice?.message?.content,
      contentPreview: String(choice?.message?.content || '').slice(0, 80),
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens || 0,
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

    return extractDeepSeekText(response.data);
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const errorCode = data?.error?.code || data?.error?.type || 'unknown_error';

    console.error('❌ Capsule DeepSeek failed:', {
      route,
      model: DEEPSEEK_MODEL,
      mode: 'non-thinking',
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

    return '';
  }
}

async function generateCapsuleInterviewQuestion(body) {
  const route = '/capsule/interview';
  const brief = buildCompactMemoryBrief(body);
  const messages = compactMessages(body.messages);
  const spark = isMomoSpark(body);

  const system = `
You are Akasha Cube AI Life Interviewer.

Your job:
Help the user remember, not perform.
Do not write the capsule yet.
Do not sound like a therapist.
Do not sound like a formal interviewer.
Sound like a warm companion who is gently helping the user open one memory.
`.trim();

  const prompt = `
${brief}

${spark ? momoSparkInterviewRule() : ''}

Recent conversation:
${messages.map((m) => `${m.role}: ${m.text}`).join('\n')}

Rules:
- Ask only ONE question.
- The question must be specific to this memory.
- If this came from Momo Diary, acknowledge that Momo already kept this little life fragment.
- If this came from Momo Memory Spark, acknowledge that Momo found this spark during chat.
- If media exists, mention it gently, but never pretend you can see or hear details not described.
- Avoid generic questions like 「你現在感覺如何？」
- Use Traditional Chinese.
- Keep it under 80 Chinese characters.
`.trim();

  const reply = await callDeepSeek({
    route,
    userId: body.userId,
    system,
    prompt,
    maxTokens: 90,
    temperature: 0.7,
  });

  if (reply) return reply;

  if (spark) {
    return '這顆火花裡，你最想讓未來的自己記住哪一句話？';
  }

  return '這段記憶裡，你最想讓未來的誰明白哪一個瞬間？';
}

async function generateCapsuleStoryDraft(body) {
  const route = '/capsule/story';
  const brief = buildCompactMemoryBrief(body);
  const messages = compactMessages(body.messages);
  const spark = isMomoSpark(body);
  const diary = isMomoDiary(body);
  const draftMode = safeText(body.draftMode) || 'future_self';
  const style = safeText(body.style) || 'gentle_letter';

  const system = `
You are Akasha Cube AI Story Weaver.

The user is creating a future time capsule.
This is not a school essay.
This is not marketing copy.
This is a human memory being sealed into time.
`.trim();

  const prompt = `
${brief}

${spark ? momoSparkStoryRule() : ''}

Draft mode:
${draftMode}

Draft mode rules:
- future_self: write to the user's future self
- recipient: write to another person
- family: write to a family member
- freeform: do not force any opening salutation
- Never mention Momo in the final letter body
- Never write 「Momo說」 「Momo覺得」 「Momo幫我」 「Momo的小火花」
- The final letter must sound like the user wrote it

Recent interview:
${messages.map((m) => `${m.role}: ${m.text}`).join('\n')}

Style:
${style}

Style guide:
${styleGuide(style)}

Writing rules:
- Use Traditional Chinese.
- Preserve the user's original emotional truth.
- Do not over-polish.
- Do not invent facts.
- If media exists, write as if the user is holding that memory, but do not describe unseen details.
- If this came from Momo Diary, naturally mention that this memory was first kept by Momo.
- Make it feel personal, not generic.
- Do not use clichés like 「時光荏苒」 unless it truly fits.
- Length: ${spark ? '220 to 520' : '350 to 650'} Chinese characters.
- End with a soft future-facing sentence.
`.trim();

  const story = await callDeepSeek({
    route,
    userId: body.userId,
    system,
    prompt,
    maxTokens: 520,
    temperature: 0.72,
  });

  if (story) return story;

  const rawText = safeText(body.rawText);
  const diaryStoryDraft = safeText(body.diaryStoryDraft);
  const sparkExcerpt = safeText(body.memoryContext?.sparkExcerpt);

  if (spark) {
    const base = sparkExcerpt || rawText;

    return `
${base}

這些話可能還不完整，也可能還有點混亂，但它是真實的。它來自現在的我，來自這段正在經歷的時間。

如果未來某一天重新看到這段話，希望你能記得，這一刻的我不是完美的，但我有努力把自己留下來。
`.trim();
  }

  if (diary) {
    const base = diaryStoryDraft || rawText;

    return `
這是我曾經保存下來的一段記錄。

${base}

它也許不是什麼驚天動地的大事，但它曾經真實地停在我的生活裡，也停在我的心裡。

如果未來某一天我重新看到這顆膠囊，希望我能記得，那時候的自己曾經這樣走過。
`.trim();
  }

  return `
這是一段我想好好保存下來的記憶。

${rawText}

它也許不是什麼驚天動地的大事，但它曾經真實地停在我的生活裡，也停在我的心裡。

如果未來某一天你收到這顆膠囊，我希望你知道，這些話不是突然想起，而是我曾經很認真地想把這一刻留下來。

願那時候的你，能重新感覺到這段記憶還帶著一點溫度。
`.trim();
}

module.exports = {
  generateCapsuleInterviewQuestion,
  generateCapsuleStoryDraft,
};
