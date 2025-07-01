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
    console.error('❌ DeepSeek 回應失敗:', error.response?.data || error.message);
    return '抱歉，我目前無法回應你的問題。';
  }
}

module.exports = {
  getChatReply
};