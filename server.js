const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const chatRoutes = require('./routes/chat');
app.use('/chat', chatRoutes);

app.get('/', (req, res) => {
  res.send('AChat API Server is running.');
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});