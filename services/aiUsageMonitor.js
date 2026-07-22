const fs = require('fs');
const path = require('path');

const DAILY_REQUEST_LIMIT = Number(process.env.AI_DAILY_REQUEST_LIMIT || 300);
const DAILY_EST_TOKEN_LIMIT = Number(process.env.AI_DAILY_EST_TOKEN_LIMIT || 1500000);
const USER_HOURLY_REQUEST_LIMIT = Number(process.env.AI_USER_HOURLY_REQUEST_LIMIT || 60);

const CHAT_FLASH_MODEL = 'deepseek-v4-flash';

const usageDir = path.join('/tmp', 'akasha-ai-usage');

function ensureDir() {
  if (!fs.existsSync(usageDir)) {
    fs.mkdirSync(usageDir, { recursive: true });
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function usageFilePath() {
  ensureDir();
  return path.join(usageDir, `ai-usage-${todayKey()}.json`);
}

function nowHourKey() {
  const now = new Date();
  return now.toISOString().slice(0, 13);
}

function readUsage() {
  try {
    const file = usageFilePath();
    if (!fs.existsSync(file)) {
      return {
        date: todayKey(),
        totalRequests: 0,
        totalEstimatedTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        byRoute: {},
        byModel: {},
        byUserHour: {},
        failures: {},
        updatedAt: new Date().toISOString(),
      };
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error('⚠️ AI usage read failed:', error.message);
    return {
      date: todayKey(),
      totalRequests: 0,
      totalEstimatedTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      byRoute: {},
      byModel: {},
      byUserHour: {},
      failures: {},
      updatedAt: new Date().toISOString(),
    };
  }
}

function writeUsage(data) {
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(usageFilePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('⚠️ AI usage write failed:', error.message);
  }
}

function estimateTokensFromChars(chars) {
  return Math.ceil(Number(chars || 0) / 2);
}

function getUserHourKey(userId) {
  return `${userId || 'anonymous'}::${nowHourKey()}`;
}

function isForbiddenChatModel(route, model) {
  return route === '/chat' && String(model || '').trim() !== CHAT_FLASH_MODEL;
}

function canCallAI({
  userId = 'anonymous',
  route = 'unknown',
  model = 'unknown',
  estimatedTokens = 0,
} = {}) {
  if (isForbiddenChatModel(route, model)) {
    console.error('[AI_BLOCKED]', {
      reason: 'FORBIDDEN_CHAT_MODEL',
      route,
      attemptedModel: model,
      allowedModel: CHAT_FLASH_MODEL,
    });

    return {
      allowed: false,
      reason: 'FORBIDDEN_CHAT_MODEL',
      message: 'Momo 的模型安全鎖攔住了異常設定，這句我先幫你留著。',
    };
  }

  const usage = readUsage();
  const userHourKey = getUserHourKey(userId);
  const userHourCount = usage.byUserHour[userHourKey] || 0;

  if (usage.totalRequests >= DAILY_REQUEST_LIMIT) {
    console.error('[AI_BLOCKED]', {
      reason: 'DAILY_REQUEST_LIMIT',
      route,
      model,
      totalRequests: usage.totalRequests,
      limit: DAILY_REQUEST_LIMIT,
    });

    return {
      allowed: false,
      reason: 'DAILY_REQUEST_LIMIT',
      message: 'AI 今日用量已達安全上限，膠囊內容已先保留。',
    };
  }

  if (usage.totalEstimatedTokens + estimatedTokens >= DAILY_EST_TOKEN_LIMIT) {
    console.error('[AI_BLOCKED]', {
      reason: 'DAILY_EST_TOKEN_LIMIT',
      route,
      model,
      totalEstimatedTokens: usage.totalEstimatedTokens,
      estimatedTokens,
      limit: DAILY_EST_TOKEN_LIMIT,
    });

    return {
      allowed: false,
      reason: 'DAILY_EST_TOKEN_LIMIT',
      message: 'AI 今日 Token 已達安全上限，膠囊內容已先保留。',
    };
  }

  if (userHourCount >= USER_HOURLY_REQUEST_LIMIT) {
    console.error('[AI_BLOCKED]', {
      reason: 'USER_HOURLY_REQUEST_LIMIT',
      userId,
      route,
      model,
      userHourCount,
      limit: USER_HOURLY_REQUEST_LIMIT,
    });

    return {
      allowed: false,
      reason: 'USER_HOURLY_REQUEST_LIMIT',
      message: 'Momo 這小時被叫太多次了，先休息一下。',
    };
  }

  return {
    allowed: true,
    reason: 'OK',
  };
}

function recordAIUsage({
  userId = 'anonymous',
  route = 'unknown',
  model = 'unknown',
  payloadChars = 0,
  promptTokens = 0,
  completionTokens = 0,
  success = true,
  status = 200,
  errorCode = '',
  latencyMs = 0,
} = {}) {
  const usage = readUsage();

  const estimatedTokens =
    Number(promptTokens || 0) +
    Number(completionTokens || 0) ||
    estimateTokensFromChars(payloadChars);

  usage.totalRequests += 1;
  usage.totalEstimatedTokens += estimatedTokens;
  usage.totalPromptTokens += Number(promptTokens || 0);
  usage.totalCompletionTokens += Number(completionTokens || 0);

  usage.byRoute[route] = usage.byRoute[route] || {
    requests: 0,
    estimatedTokens: 0,
  };
  usage.byRoute[route].requests += 1;
  usage.byRoute[route].estimatedTokens += estimatedTokens;

  usage.byModel[model] = usage.byModel[model] || {
    requests: 0,
    estimatedTokens: 0,
  };
  usage.byModel[model].requests += 1;
  usage.byModel[model].estimatedTokens += estimatedTokens;

  const userHourKey = getUserHourKey(userId);
  usage.byUserHour[userHourKey] = (usage.byUserHour[userHourKey] || 0) + 1;

  if (!success) {
    const key = `${status || 'unknown'}::${errorCode || 'unknown_error'}`;
    usage.failures[key] = (usage.failures[key] || 0) + 1;
  }

  writeUsage(usage);

  console.log('[AI_USAGE]', {
    userId: userId || 'anonymous',
    route,
    model,
    payloadChars,
    estimatedTokens,
    promptTokens,
    completionTokens,
    success,
    status,
    errorCode,
    latencyMs,
    todayRequests: usage.totalRequests,
    todayEstimatedTokens: usage.totalEstimatedTokens,
  });
}

function getUsageSummary() {
  return readUsage();
}

module.exports = {
  canCallAI,
  recordAIUsage,
  getUsageSummary,
  estimateTokensFromChars,
};
