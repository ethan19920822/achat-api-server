const axios = require('axios');
require('dotenv').config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

async function getChatReply(message, userId) {
  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一個溫柔又真誠的AI助手，請用中文回答用戶的問題。' },
          { role: 'user', content: message }
        ],
        temperature: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data.choices[0].message.content.trim();
    return reply;

  } catch (error) {
  console.error('DeepSeek 回應失敗:', error.response?.data || error.message);

  const fallbackReplies = [
    "我剛剛有點失神了，但我還在這裡。",
    "我暫時連不到思緒的深處，你可以再跟我說一次嗎？",
    "我還在整理剛才的訊息，你願意再告訴我一次嗎？",
    "我在聽，只是剛剛有點卡住了。",
    "你說的事情對你很重要，我還在這裡陪你。"
  ];

  const randomReply = fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];
  return randomReply;
}
}

module.exports = {
  getChatReply
};
