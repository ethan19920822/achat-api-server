const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const admin = require('firebase-admin');

const router = express.Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

function getServiceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing');

  const parsed = JSON.parse(raw);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function ensureFirebaseAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(getServiceAccountFromEnv()),
    });
  }
  return admin;
}

ensureFirebaseAdmin();
const db = admin.firestore();

function safeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function codeSecret() {
  const secret = String(process.env.EMAIL_CODE_SECRET || '').trim();
  if (!secret) throw new Error('EMAIL_CODE_SECRET is missing');
  return secret;
}

function hashCode({ uid, email, code, expiresAtMs }) {
  return crypto
    .createHmac('sha256', codeSecret())
    .update(`${uid}:${email}:${code}:${expiresAtMs}`)
    .digest('hex');
}

function secureEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left), 'hex');
    const b = Buffer.from(String(right), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function generateSixDigitCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

function bearerToken(req) {
  const header = String(req.get('authorization') || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

async function requireFirebaseUser(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'missing_auth_token',
        message: '缺少登入憑證',
      });
    }

    const decoded = await admin.auth().verifyIdToken(token, true);
    const user = await admin.auth().getUser(decoded.uid);

    req.firebaseUser = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      error: 'invalid_auth_token',
      message: '登入狀態已失效，請重新登入',
    });
  }
}

function buildVerificationHtml({ code, email }) {
  const first = code.slice(0, 3);
  const second = code.slice(3);

  return `<!doctype html>
<html lang="zh-Hant">
<body style="margin:0;padding:0;background:#120c08;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;color:#3a2417">
  <div style="max-width:620px;margin:0 auto;padding:32px 18px">
    <div style="background:#fff5e5;border:1px solid #e8c99d;border-radius:28px;padding:34px 26px;box-shadow:0 18px 60px rgba(0,0,0,.24)">
      <div style="color:#9a6a35;font-size:12px;font-weight:800;letter-spacing:.22em">AKASHA CUBE</div>
      <h1 style="margin:16px 0 8px;font-size:29px;line-height:1.25;color:#342014">驗證你的 Email</h1>
      <p style="margin:0;color:#76583e;font-size:15px;line-height:1.7">
        請回到 Akasha Cube，輸入下方六位數驗證碼。
      </p>

      <div style="margin:28px 0;padding:24px 18px;border-radius:22px;background:#2a180f;color:#ffd88d;text-align:center;font-size:38px;font-weight:900;letter-spacing:.22em">
        ${first}&nbsp;${second}
      </div>

      <p style="margin:0;color:#76583e;font-size:14px;line-height:1.8">
        驗證碼將在 10 分鐘後失效。<br/>
        請勿把這組驗證碼交給任何人。<br/>
        驗證帳號：${email}
      </p>

      <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(90,55,20,.14);color:#987554;font-size:13px;line-height:1.7">
        如果你沒有建立 Akasha Cube 帳號，可以忽略這封信。<br/>
        記憶・時間・光
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildVerificationText({ code, email }) {
  return [
    'AKASHA CUBE',
    '',
    '驗證你的 Email',
    '',
    `驗證碼：${code}`,
    '',
    '驗證碼將在 10 分鐘後失效。',
    '請勿把這組驗證碼交給任何人。',
    `驗證帳號：${email}`,
    '',
    '記憶・時間・光',
  ].join('\n');
}

async function sendWithResend({ to, code }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is missing');

  const from =
    process.env.AUTH_FROM_EMAIL ||
    process.env.CAPSULE_FROM_EMAIL ||
    'Akasha Cube <onboarding@resend.dev>';

  const response = await axios.post(
    'https://api.resend.com/emails',
    {
      from,
      to,
      subject: '你的 Akasha Cube 驗證碼',
      html: buildVerificationHtml({ code, email: to }),
      text: buildVerificationText({ code, email: to }),
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  return response.data;
}

router.post('/send', requireFirebaseUser, async (req, res) => {
  try {
    const user = req.firebaseUser;
    const uid = user.uid;
    const email = safeEmail(user.email);

    if (!email) {
      return res.status(400).json({
        error: 'email_missing',
        message: '這個帳號沒有可驗證的 Email',
      });
    }

    if (user.emailVerified) {
      return res.status(200).json({
        ok: true,
        alreadyVerified: true,
      });
    }

    const ref = db.collection('_auth_email_codes').doc(uid);
    const nowMs = Date.now();

    let code = '';
    let expiresAtMs = 0;
    let hourlyCount = 1;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() || {};

      const lastSentAtMs = Number(data.lastSentAtMs || 0);
      const windowStartedAtMs = Number(data.windowStartedAtMs || 0);
      const previousHourlyCount = Number(data.hourlyCount || 0);

      if (lastSentAtMs && nowMs - lastSentAtMs < RESEND_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil(
          (RESEND_COOLDOWN_MS - (nowMs - lastSentAtMs)) / 1000,
        );
        const error = new Error('cooldown');
        error.retryAfterSeconds = retryAfterSeconds;
        throw error;
      }

      if (
        windowStartedAtMs &&
        nowMs - windowStartedAtMs < HOURLY_WINDOW_MS
      ) {
        hourlyCount = previousHourlyCount + 1;
      } else {
        hourlyCount = 1;
      }

      if (hourlyCount > MAX_SENDS_PER_HOUR) {
        const error = new Error('hourly_limit');
        error.retryAfterSeconds = Math.ceil(
          (HOURLY_WINDOW_MS - (nowMs - windowStartedAtMs)) / 1000,
        );
        throw error;
      }

      code = generateSixDigitCode();
      expiresAtMs = nowMs + CODE_TTL_MS;

      tx.set(
        ref,
        {
          uid,
          email,
          codeHash: hashCode({
            uid,
            email,
            code,
            expiresAtMs,
          }),
          expiresAtMs,
          attempts: 0,
          lastSentAtMs: nowMs,
          windowStartedAtMs:
            windowStartedAtMs &&
            nowMs - windowStartedAtMs < HOURLY_WINDOW_MS
              ? windowStartedAtMs
              : nowMs,
          hourlyCount,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    const result = await sendWithResend({ to: email, code });

    await ref.set(
      {
        provider: 'resend',
        providerId: result?.id || '',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return res.status(200).json({
      ok: true,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
      resendAfterSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
    });
  } catch (error) {
    if (error.message === 'cooldown') {
      return res.status(429).json({
        error: 'resend_cooldown',
        message: '請稍後再重新寄送',
        retryAfterSeconds: error.retryAfterSeconds || 60,
      });
    }

    if (error.message === 'hourly_limit') {
      return res.status(429).json({
        error: 'hourly_send_limit',
        message: '今天寄送得太頻繁了，請稍後再試',
        retryAfterSeconds: error.retryAfterSeconds || 3600,
      });
    }

    console.error('[EMAIL_CODE_SEND_ERROR]', error);
    return res.status(500).json({
      error: 'send_failed',
      message: '驗證碼寄送失敗，請稍後再試',
    });
  }
});

router.post('/verify', requireFirebaseUser, async (req, res) => {
  try {
    const user = req.firebaseUser;
    const uid = user.uid;
    const email = safeEmail(user.email);
    const code = String(req.body?.code || '').replace(/\D/g, '');

    if (user.emailVerified) {
      return res.status(200).json({
        ok: true,
        alreadyVerified: true,
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: 'invalid_code_format',
        message: '請輸入完整六位數驗證碼',
      });
    }

    const ref = db.collection('_auth_email_codes').doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({
        error: 'code_not_found',
        message: '找不到驗證碼，請重新寄送',
      });
    }

    const data = snap.data() || {};
    const expiresAtMs = Number(data.expiresAtMs || 0);
    const attempts = Number(data.attempts || 0);

    if (!expiresAtMs || Date.now() > expiresAtMs) {
      await ref.delete();
      return res.status(410).json({
        error: 'code_expired',
        message: '驗證碼已失效，請重新寄送',
      });
    }

    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      await ref.delete();
      return res.status(429).json({
        error: 'attempt_limit',
        message: '輸入錯誤次數過多，請重新取得驗證碼',
      });
    }

    const expectedHash = hashCode({
      uid,
      email,
      code,
      expiresAtMs,
    });

    if (!secureEqualHex(expectedHash, data.codeHash)) {
      const nextAttempts = attempts + 1;
      await ref.set(
        {
          attempts: nextAttempts,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return res.status(400).json({
        error: 'code_mismatch',
        message: '驗證碼不正確',
        remainingAttempts: Math.max(0, MAX_VERIFY_ATTEMPTS - nextAttempts),
      });
    }

    await admin.auth().updateUser(uid, { emailVerified: true });

    await db.collection('users').doc(uid).set(
      {
        email,
        emailVerified: true,
        emailVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await ref.delete();

    return res.status(200).json({
      ok: true,
      verified: true,
    });
  } catch (error) {
    console.error('[EMAIL_CODE_VERIFY_ERROR]', error);
    return res.status(500).json({
      error: 'verify_failed',
      message: '驗證失敗，請稍後再試',
    });
  }
});

module.exports = router;
