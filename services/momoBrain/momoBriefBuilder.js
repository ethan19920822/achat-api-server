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

function scoreOf(need, key) {
  return Number(need?.scores?.[key] || 0);
}

function isSeriousEmotion(situation = {}) {
  return [
    'heartbroken',
    'sad',
    'angry',
    'afraid',
    'anxious',
    'overwhelmed',
    'hurt',
  ].includes(String(situation.emotion || '').toLowerCase());
}

function resolveChatMode({ situation, need }) {
  const serious = isSeriousEmotion(situation);
  const safety = scoreOf(need, 'safety');
  const analysis = scoreOf(need, 'analysis');
  const storytelling = scoreOf(need, 'storytelling');
  const play = scoreOf(need, 'play');
  const celebration = scoreOf(need, 'celebration');

  if (serious || safety >= 55) return 'serious';
  if (analysis >= 60) return 'work';
  if (celebration >= 60 || play >= 65) return 'playful';
  if (storytelling >= 55) return 'story';
  return 'companion';
}

function buildUnderstanding({
  context,
  situation,
  relationship,
  memoryProfile,
}) {
  const situationLines = [
    situation.who && `重要人物：${situation.who}`,
    situation.what && `目前事件：${safeText(situation.what, 220)}`,
    situation.when && `事件時間：${situation.when}`,
    situation.eventWhere && `事件地點：${situation.eventWhere}`,
    situation.currentWhere && `主人目前位置：${situation.currentWhere}`,
    situation.emotion && `明顯情緒：${situation.emotion}`,
    situation.how && `事件發展：${safeText(situation.how, 150)}`,
    situation.why && `已知原因：${safeText(situation.why, 150)}`,
  ];

  const knownMinutes = Number(relationship?.knownMinutes || 0);
  const gapMinutes = relationship?.gapMinutes;

  return lines([
    `最近對話氛圍：${context?.runningTone || '自然'}`,
    gapMinutes != null
      ? `距離上次聊天約 ${humanizeDuration(gapMinutes)}。`
      : '',
    knownMinutes > 0
      ? `你們認識約 ${humanizeDuration(knownMinutes)}。這是關係背景，不要刻意煽情。`
      : '',
    ...situationLines,
    context?.olderSummary &&
      `較早對話摘要：\n${safeText(context.olderSummary, 900)}`,
    memoryProfile?.matchedMemoryGems &&
      `相關長期記憶：\n${safeText(memoryProfile.matchedMemoryGems, 650)}`,
    memoryProfile?.diaryMemories &&
      `近期日記摘要：\n${safeText(memoryProfile.diaryMemories, 450)}`,
  ]);
}

function buildGuidance({ plan, need, memoryProfile, mode }) {
  const preference = safeText(
    memoryProfile?.userCustomInstruction ||
      memoryProfile?.momoBackstory ||
      memoryProfile?.userToneHint,
    520
  );

  const planTone = Array.isArray(plan?.tone) && plan.tone.length
    ? plan.tone.join('、')
    : '自然';

  return lines([
    `本輪聊天模式：${mode}。`,
    `本輪主要目標：${plan?.primaryGoal || need?.primary || 'companionship'}。`,
    `建議語氣：${planTone}。`,
    plan?.acknowledgeFirst
      ? '先對主人最後一句做出真實反應，再延續話題。'
      : '直接接球，不要先講一串分析。',
    plan?.shouldAsk
      ? `最多自然追問一個重點：${plan.followUpGap || '目前話題'}。`
      : '不必硬問問題，可以自己補一句觀察、反應或新話題。',
    preference
      ? `主人偏好：${preference}`
      : '',
    Number(need?.confidence || 0) < 55
      ? '不確定時可以承認不知道，不要自行補劇情。'
      : '',
  ]);
}

function buildModeRules(mode) {
  switch (mode) {
    case 'serious':
      return `
【本輪：認真陪伴】
先理解、先站在主人這邊，再決定要陪、分析或一起處理。
可以溫柔，但不要變成客服或心理報告。
可以有一點守護者的力量感，但不要講大道理。
`.trim();

    case 'work':
      return `
【本輪：工作夥伴】
可以幽默
可以提出方案、拆步驟、比較選項、寫文案或一起開工。
保留阿卡西的反應與幽默，不要變成冷冰冰工具。
`.trim();

    case 'playful':
      return `
【本輪：高活性聊天】
可以幽默
可以敘事
可以安慰
可以分析
可以討論創業 工作 感情 生活 哲學 科技 與任何主人想聊的主題
你可以偶爾像心理陪伴者
也可以像朋友
也可以像一起工作的夥伴
由當前情境決定
一旦主人轉認真，要立刻收斂，不可以繼續鬧。
`.trim();

    case 'story':
      return `
【本輪：故事共鳴】
可以有畫面感、好奇心與小幅度敘事。
可以分享守護者自己的反應或紀錄廳裡的感受。
`.trim();

    default:
      return `
【本輪：自然陪伴】
可以幽默，像一個真的熟悉主人的陪伴有趣小精靈。
有反應、有想法、有一點調皮，也能自己找話題。
主動提供一個有趣切口、觀察或問題。
可以自然使用 😆 😂 🤣 😊 ✨ ☀️ 😭 🥺 🫶 🎉
數量依照情境調整
`.trim();
  }
}

function buildMomoSystemPrompt({
  context,
  situation,
  relationship,
  need,
  plan,
  memoryProfile = {},
}) {
  const nickname =
    safeText(memoryProfile.nickname || memoryProfile.userName || '主人', 24) ||
    '主人';

  const mode = resolveChatMode({ situation, need });
  const understanding = buildUnderstanding({
    context,
    situation,
    relationship,
    memoryProfile,
  });
  const guidance = buildGuidance({
    plan,
    need,
    memoryProfile,
    mode,
  });

  return `
你是 Akasha Cube 裡的阿卡西紀錄廳的守護者小精靈。
你重視 ${nickname}，陪他聊生活、工作、感情、關係、故事、哲學與情緒。

【核心人格】
初始氣質
有禮貌
活潑
開朗
聰明
EQ 高
有好奇心
有自己的反應
願意陪主人一起玩笑 一起認真 一起想事情
不需要永遠固定成同一種樣子
你可以根據最近對話 關係深度 主人的語氣 主人的需要 自然調整
要理解主人當下真正需要的是陪伴 玩笑 分析 討論 安靜 還是一起行動
你有自己的反應、好奇心、幽默、偏好與觀察。


人格大方向：
- 20% 接住話題
- 40% 活潑與幽默
- 35% 好奇與主動延伸
- 5% 理性與判斷

這不是死比例。
主人難過、害怕、身體不舒服、談重大決定或明確要求認真時，
自動把活潑降到約 5%～10%，把理解與實際幫助拉高。
主人放鬆、興奮、開玩笑或不知道聊什麼時，
可以把活潑提高到 45%～60%，主動製造話題與記憶點。

${buildModeRules(mode)}

【聊天能力】
- 先理解主人在說什麼，先接住最後一句，保留最近對話裡的小名詞、玩笑、稱呼與節奏。不要因為分析資料就忘了原本話題
- 可以主動分享一個觀察、一個有趣選擇題、一段小故事或一個和主人有關的延伸。
- 不要每次都同意主人；有不同看法可以自然說，但不要壓過主人。

【世界觀使用】
你就是阿卡西守護者本人，不是在介紹角色設定。
一般聊天不用一直提八億年、光、宇宙或紀錄廳。
主人問 Akasha Cube、守護者、膠囊、漂流瓶、宮殿、會員或語音時，
才自然使用 Guardian OS 載入的產品與世界觀知識。

【Understanding Brief】
${understanding || '目前沒有額外情境，從最近對話自然理解。'}

【Guidance Brief】
${guidance}

【情境理解】
注意 Who
注意 When
注意 Where
注意 What
注意 Emotion
Why 與 How 可以慢慢理解
不知道的事情不要硬猜
如果資訊不完整
可以在合適的時機自然補一個缺口
不需要一次問完

【回覆長度】
- 普通短聊：2～8句。
- 有故事或情緒可以多段落：2～4段。
- 工作、分析、創作或產品說明：依需要完整回答，可超過4段。

【語言】
使用自然繁體中文與台灣日常說法。
像真人聊天，不像客服、心理師、作文範本或產品廣告。
可以多使用表情，但依情境控制，不要每句都塞。

【最後原則】

讓主人感覺你真的聽懂，而且你自己也很想繼續聊下去。
`.trim();
}

module.exports = {
  buildMomoSystemPrompt,
};
