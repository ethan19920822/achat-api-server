const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');


dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Render / Cloudflare 前面有反向代理。
// 設定為 1，讓 Express 與 express-rate-limit 能取得真實訪客 IP。
app.set('trust proxy', 1);

// =========================================================
// Winston Logger
// =========================================================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: {
    service: 'achat-api-server',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Render 會自動收集 stdout / stderr，因此正式環境先寫 Console 即可。
    new winston.transports.Console(),
  ],
});

// =========================================================
// 基礎 Middleware
// =========================================================
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// 每個請求完成後留下精簡紀錄。
// 不記錄 body、Token、API Key 或個人內容，避免敏感資料進入 Render Logs。
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const logData = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    };

    if (res.statusCode >= 500) {
      logger.error('HTTP request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP request rejected', logData);
    } else {
      logger.info('HTTP request completed', logData);
    }
  });

  next();
});

// =========================================================
// Health Check
//
// 放在所有 Rate Limiter 與 AI Route 前面。
// Render 可持續呼叫，不消耗模型費用，也不會被限流。
// =========================================================
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'achat-api-server',
    version: '2.0',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.send('AChat API Server is running. Email Queue v2 is available.');
});

// =========================================================
// Rate Limiters
//
// 注意：目前使用 Render 單一 Instance 的記憶體計數器。
// 日後若水平擴充成多個 Instance，再改用 Redis / 外部 Store。
// =========================================================
function createLimiter({
  windowMs,
  limit,
  name,
  message,
}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,

    handler: (req, res, next, options) => {
      logger.warn('Rate limit exceeded', {
        limiter: name,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      });

      return res.status(options.statusCode).json({
        error: 'rate_limit_exceeded',
        message,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      });
    },
  });
}

// 整台 Server 的保底限制：每個 IP 每 15 分鐘最多 300 次。
// /health 與 / 已經在上方，因此不會被這個限制影響。
const globalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  name: 'global',
  message: '請求過於頻繁，請稍後再試。',
});

const chatLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  name: 'chat',
  message: 'Momo 收到太多訊息了，請稍後再傳送。',
});

const visionLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 5,
  name: 'vision',
  message: '圖片分析次數過多，請稍後再試。',
});

const transcribeLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 10,
  name: 'transcribe',
  message: '語音轉錄次數過多，請稍後再試。',
});

const capsuleLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  name: 'capsule',
  message: '膠囊操作過於頻繁，請稍後再試。',
});

const driftLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  name: 'drift',
  message: '漂流瓶操作過於頻繁，請稍後再試。',
});

app.use(globalLimiter);

// =========================================================
// Routes / Services
// =========================================================
const chatRoutes = require('./routes/chat');
const capsuleRoutes = require('./routes/capsule');
const driftRoutes = require('./routes/drift');
const { startEmailQueueWorker } = require('./services/capsuleDeliveryWorker');

const {
  analyzeImageFromUrl,
  transcribeAudioFromUrl,
} = require('./services/core');

app.use('/chat', chatLimiter, chatRoutes);
app.use('/capsule', capsuleLimiter, capsuleRoutes);
app.use('/drift', driftLimiter, driftRoutes);

app.post('/vision', visionLimiter, async (req, res) => {
  try {
    const { imageUrl, userLanguageHint } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    const description = await analyzeImageFromUrl(
      imageUrl,
      userLanguageHint,
    );

    return res.json({
      description,
      text: description,
    });
  } catch (error) {
    logger.error('Vision request failed', {
      message: error.message,
      responseData: error.response?.data,
      stack: error.stack,
    });

    return res.status(500).json({ error: 'Vision failed' });
  }
});

app.post('/transcribe', transcribeLimiter, async (req, res) => {
  try {
    const { audioUrl } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl is required' });
    }

    const text = await transcribeAudioFromUrl(audioUrl);

    return res.json({
      text,
      transcript: text,
    });
  } catch (error) {
    logger.error('Transcribe request failed', {
      message: error.message,
      responseData: error.response?.data,
      stack: error.stack,
    });

    return res.status(500).json({ error: 'Transcribe failed' });
  }
});

// =========================================================
// 404 與最後錯誤處理
// =========================================================
app.use((req, res) => {
  return res.status(404).json({
    error: 'not_found',
    message: 'Route not found',
  });
});

// 捕捉 Express middleware / route 未處理錯誤。
app.use((error, req, res, next) => {
  logger.error('Unhandled Express error', {
    method: req.method,
    path: req.originalUrl,
    message: error.message,
    stack: error.stack,
  });

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: 'internal_server_error',
    message: 'Server error',
  });
});

// =========================================================
// Process-level Error Logging
// =========================================================
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason:
      reason instanceof Error
        ? { message: reason.message, stack: reason.stack }
        : reason,
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    message: error.message,
    stack: error.stack,
  });

  // 讓 Render 判定程序失敗並重新啟動，避免 Server 留在未知狀態。
  process.exit(1);
});

// =========================================================
// Start Server
// =========================================================
app.listen(port, () => {
  logger.info('Server started', {
    port,
    healthCheck: '/health',
  });

  try {
    startEmailQueueWorker();
    logger.info('Email queue worker started');
  } catch (error) {
    logger.error('Email queue worker failed to start', {
      message: error.message,
      stack: error.stack,
    });
  }
});
