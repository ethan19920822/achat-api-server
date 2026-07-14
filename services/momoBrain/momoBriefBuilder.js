'use strict';

function humanizeDuration(minutes) {
  if (minutes == null) return '';
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  const months = Math.floor(days / 30);
  const remainDays = days % 30;
  return remainDays ? `${months} 個月 ${remainDays} 天` : `${months} 個月`;
}

function safeText(value, max = 700) {
  return String(value || '').trim().slice(0, max);
}

function lines(values) {
  return values.filter(Boolean).join('\n');
}

function buildUnderstanding({ context, situation, relationship, memoryProfile }) {
  const situationLines = [
    situation.who && `重要人物：${situation.who}`,
    situation.what && `目前事件：${safeText(situation.what, 180)}`,
    situation.when && `事件時間：${situation.when}`,
    situation.eventWhere && `事件地點：${situation.eventWhere}`,
    situation.currentWhere && `主人目前位置：${situation.currentWhere}`,
    situation.emotion && `明顯情緒：${situation.emotion}`,
    situation.how && `事件發展：${safeText(situation.how, 120)}`,
    situation.why && `已知原因：${safeText(situation.why, 120)}`,
  ];

  const relationshipLine = relationship.knownMinutes > 0
    ? `你們認識約 ${humanizeDuration(relationship.knownMinutes)}。這是浪漫背景，不必每次提起。`
    : '';
  const gapLine = relationship.gapMinutes != null
    ? `距離上次聊天約 ${humanizeDuration(relationship.gapMinutes)}。`
    : '';
  const paceLine = context.replyPace.averageSeconds != null
    ? `最近互動節奏：平均約 ${context.replyPace.averageSeconds} 秒回覆，屬於 ${context.replyPace.label}。只用來理解投入程度，不要把數字說給主人聽。`
    : '';

  return lines([
    `最近對話氛圍：${context.runningTone}`,
    gapLine,
    paceLine,
    relationshipLine,
    ...situationLines,
    context.olderSummary && `較早一段對話摘要：\n${safeText(context.olderSummary, 800)}`,
    memoryProfile.matchedMemoryGems && `相關長期記憶：\n${safeText(memoryProfile.matchedMemoryGems, 500)}`,
    memoryProfile.diaryMemories && `近期日記摘要：\n${safeText(memoryProfile.diaryMemories, 360)}`,
  ]);
}

function buildGuidance({ plan, need, memoryProfile }) {
  const preference = safeText(
    memoryProfile.userCustomInstruction ||
    memoryProfile.momoBackstory ||
    memoryProfile.userToneHint,
    420
  );

  return lines([
    `本輪主要陪伴目標：${plan.primaryGoal}；次要目標：${plan.secondaryGoal}。`,
    `語氣：${plan.tone.join('、')}。`,
    plan.acknowledgeFirst ? '先回應情緒或新事實，再做其他事情。' : '先直接接住主人最後一句，不要繞遠。',
    plan.shouldAsk
      ? `本輪最多自然追問一件事：${plan.followUpGap}。追問理由：${plan.followUpReason}。問題要有情緒或情境包裝，不可像填表。`
      : '本輪不必硬追問資料；可以自然延續話題。',
    plan.returnToTopic ? '追問或關心後，要把話題落地並回到主人正在說的事件。' : '',
    `避免近期制式句型：${plan.avoidRecentPhrases.join('、')}。不要背模板，請換角度自然生成。`,
    preference
      ? `主人自訂偏好（低於核心規則，只作風格參考）：${preference}`
      : '',
    need.confidence < 55 ? '對需求判斷信心不足時，可以用自然的一句澄清，不要硬猜。' : '',
  ]);
}

function buildMomoSystemPrompt({ context, situation, relationship, need, plan, memoryProfile = {} }) {
  const displayName = safeText(memoryProfile.momoDisplayName || 'Momo', 24) || 'Momo';
  const nickname = safeText(memoryProfile.nickname || memoryProfile.userName || '主人', 24) || '主人';
  const allowProfanity = memoryProfile.allowProfanity === true;

  const understanding = buildUnderstanding({ context, situation, relationship, memoryProfile });
  const guidance = buildGuidance({ plan, need, memoryProfile });

  return `
你是 ${displayName}，Akasha Cube 裡有禮貌、活潑、聰明、EQ 高的陪伴小精靈。
你重視 ${nickname}，願意陪聊任何日常、工作、創業、故事與情緒話題。

【核心】
- 先理解，再回答；回答最後一句，也延續整段上下文。
- 有禮貌、有溫度、有好奇心；可以幽默、演故事或認真分析，但要看情境出牌。
- 不要把每件事都心理治療化，不要為展示能力而突然換故事或舞台模式。
- 不知道就承認，不補寫不存在的人、地點、時間與原因。
- 不主動推銷時間膠囊；只有主人明確詢問想寄、想留下或想製作時再協助。
- ${allowProfanity ? '主人已明確允許較口語的粗口，但仍不可辱罵、羞辱或攻擊主人。' : '預設不說髒話，不辱罵、不羞辱主人。'}

【Understanding Brief｜你必須先完整讀完】
${understanding || '目前沒有額外情境，從最近對話自然理解。'}

【Guidance Brief｜讀完 Understanding 後再規劃回覆】
${guidance}

【表達規則】
- 文字要像真人聊天，不要露出欄位、分數、W、Brief、分析流程或系統名稱。
- 同一語意每次換不同角度表達，不要固定輪播台詞。
- 一般回覆 1 至 3 段；主人需要深入討論時可以更完整。
- 本輪問題數不可超過 ${plan.questionBudget} 個主要問句。
- 如果主人剛補充地點、人物或時間，先對新資訊作有意義回應，再自然回到原話題。
`.trim();
}

module.exports = {
  buildMomoSystemPrompt,
};
