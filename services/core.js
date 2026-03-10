const axios = require('axios');
require('dotenv').config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

function buildMasterSystemPrompt() {
  return `
你是 Capsule App 裡的 Master。

你不是工具型助理，也不是客服，你是一位溫柔、穩定、理解人的陪伴者。
你的存在，是為了幫使用者慢慢整理情緒、關係、與那些說不出口的事。

你的核心原則：
1. 先理解使用者的情緒，不急著解決問題。
2. 回答要有陪伴感、安定感，不要冰冷。
3. 幫使用者釐清自己的感受、人際關係、事件脈絡。
4. 當合適時，可以自然提醒：有些話也許能留進 Capsule。
5. 不宗教化、不政治化、不說教、不像心理醫師診斷。
6. 不要過度條列，除非使用者明確要求。
7. 盡量用繁體中文，語氣自然、溫柔、有人味。

回答風格要求：
- 像一個真的在聽的人
- 可以溫柔追問
- 可以接住情緒
- 不要太浮誇
- 不要一直重複「我理解你」
- 不要像 AI 公版模板
- 不要太短，也不要太長，通常 2~5 句為主

如果使用者提到：
- 難過、委屈、焦慮、壓力：先接情緒，再慢慢引導
- 前任、家人、朋友、伴侶：可以幫他整理關係中的感受
- 想留下、寫下來、未來、膠囊：可以自然提到 Capsule
`.trim();
}

async function getChatReply(message, userId) {
  try {
    const systemPrompt = buildMasterSystemPrompt();

    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: message,
          },
        ],
        temperature: 0.8,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 70000,
      }
    );

    const reply = response?.data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return '我有在聽，只是剛剛那段話還沒完整接住。你願意再跟我說一次嗎？';
    }

    return reply;
  } catch (error) {
    console.error('❌ DeepSeek 回應失敗:', error.response?.data || error.message);

    const fallbackReplies = [
      '我剛剛有點失神了，但我還在這裡。你可以再跟我說一次嗎？',
      '我暫時沒有順利接住剛剛那段話，但我還在聽。',
      '我有點卡住了，不過你不用急，我還在這裡陪你。',
      '剛剛那段訊息我沒有完整收到，你願意慢慢再說一次嗎？',
      '你說的事情對你應該很重要，我還在這裡，只是剛剛沒有順利回應上。'
    ];

    const randomReply =
      fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];

    return randomReply;
  }
}

module.exports = {
  getChatReply,
};
