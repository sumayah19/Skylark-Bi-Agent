require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { chat } = require('./src/agent');
const { isMockMode } = require('./src/mondayClient');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({ ok: true, mockMode: isMockMode() });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { history } = req.body;
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: 'Request body must include a non-empty `history` array.' });
    }
    if (!process.env.GEMINI_API_KEY) {
  return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. See README/.env.example.' });
}
    const result = await chat(history);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Skylark BI agent listening on :${PORT} (mock mode: ${isMockMode()})`);
});
