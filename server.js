const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '25mb' }));

const chatRoutes = require('./routes/chat');
const {
  analyzeImageFromUrl,
  transcribeAudioFromUrl,
} = require('./services/core');

app.use('/chat', chatRoutes);

app.post('/vision', async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    const description = await analyzeImageFromUrl(imageUrl);

    res.json({
      description,
      text: description,
    });
  } catch (error) {
    console.error('Vision error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Vision failed' });
  }
});

app.post('/transcribe', async (req, res) => {
  try {
    const { audioUrl } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl is required' });
    }

    const text = await transcribeAudioFromUrl(audioUrl);

    res.json({
      text,
      transcript: text,
    });
  } catch (error) {
    console.error('Transcribe error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Transcribe failed' });
  }
});

app.get('/', (req, res) => {
  res.send('AChat API Server is running.');
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
