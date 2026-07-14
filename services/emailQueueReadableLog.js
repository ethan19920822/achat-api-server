function safeText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function maskEmail(value) {
  const email = safeText(value);
  const at = email.indexOf('@');
  if (at <= 1) return email || '未提供';

  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'*'.repeat(Math.max(2, name.length - visible.length))}@${domain}`;
}

function formatCheckedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value, '未知時間');

  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: process.env.EMAIL_LOG_TIMEZONE || 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function statusSymbol(status) {
  switch (String(status || '').toLowerCase()) {
    case 'sent':
      return '✓';
    case 'retry':
      return '↻';
    case 'skipped':
      return '−';
    case 'permanent_failed':
      return '✕';
    case 'failed':
      return '✕';
    default:
      return '•';
  }
}

function statusLabel(status) {
  switch (String(status || '').toLowerCase()) {
    case 'sent':
      return '已寄出';
    case 'retry':
      return '等待重試';
    case 'skipped':
      return '略過';
    case 'permanent_failed':
      return '永久失敗';
    case 'failed':
      return '寄送失敗';
    default:
      return safeText(status, '未知狀態');
  }
}

function summarizeCounts(results = []) {
  return results.reduce(
    (summary, item) => {
      const key = String(item?.status || 'unknown').toLowerCase();
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    },
    {}
  );
}

function enrichQueueItem(doc, item = {}) {
  const data = typeof doc?.data === 'function' ? doc.data() || {} : {};

  return {
    ...item,
    capsuleId: item.capsuleId || doc?.id || '',
    capsuleTitle: safeText(
      data.title || data.emailSubject || data.subject,
      '未命名膠囊'
    ),
    recipientName: safeText(data.recipientName, '未命名收件人'),
    recipientEmail: safeText(data.recipientEmail, ''),
    attemptCount: Number(
      item.attemptCount ?? data.emailAttemptCount ?? 0
    ),
  };
}

function logQueueReport(result = {}) {
  const results = Array.isArray(result.results) ? result.results : [];
  const counts = summarizeCounts(results);

  const lines = [
    '',
    '================ EMAIL QUEUE REPORT ================',
    `檢查時間  ${formatCheckedAt(result.checkedAt)}`,
    `本次到期  ${Number(result.dueCount || 0)}`,
    `已寄出    ${Number(counts.sent || 0)}`,
    `等待重試  ${Number(counts.retry || 0)}`,
    `略過      ${Number(counts.skipped || 0)}`,
    `寄送失敗  ${Number(counts.failed || 0) + Number(counts.permanent_failed || 0)}`,
    '----------------------------------------------------',
  ];

  if (results.length === 0) {
    lines.push('本次沒有需要寄送的膠囊');
  } else {
    results.forEach((item, index) => {
      const title = safeText(item.capsuleTitle, '未命名膠囊');
      const recipient = safeText(item.recipientName, '未命名收件人');
      const email = maskEmail(item.recipientEmail);
      const status = statusLabel(item.status);
      const symbol = statusSymbol(item.status);
      const attempt = Number(item.attemptCount || 0);

      lines.push(
        `${symbol} ${index + 1}. ${title}`,
        `   收件人  ${recipient}`,
        `   Email   ${email}`,
        `   狀態     ${status}${attempt > 0 ? `  第 ${attempt} 次嘗試` : ''}`
      );

      if (item.failureReason) {
        lines.push(`   原因     ${safeText(item.failureReason)}`);
      } else if (item.error) {
        lines.push(`   錯誤     ${safeText(item.error).slice(0, 240)}`);
      }
    });
  }

  lines.push('====================================================', '');
  console.log(lines.join('\n'));
}

module.exports = {
  enrichQueueItem,
  logQueueReport,
};
