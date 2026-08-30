const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('input');
const statusEl = document.getElementById('status');
const suggestionsEl = document.getElementById('suggestions');

let history = [];

const SUGGESTIONS = [
  "How's our pipeline looking by sector?",
  'Which sector has the most work orders stuck?',
  'Prepare a leadership update',
  "Are we executing on what we've won?",
  'Billing vs collections this year',
];

function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `<div class="role">${role === 'user' ? 'You' : 'Agent'}</div><div class="bubble"></div>`;
  wrap.querySelector('.bubble').textContent = text;
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return wrap;
}

function renderSuggestions() {
  suggestionsEl.innerHTML = '';
  SUGGESTIONS.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = s;
    b.onclick = () => { input.value = s; form.requestSubmit(); };
    suggestionsEl.appendChild(b);
  });
}

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    statusEl.textContent = data.mockMode ? 'sample data mode' : 'connected · monday.com live';
    statusEl.classList.toggle('mock', !!data.mockMode);
  } catch {
    statusEl.textContent = 'offline';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMessage('user', text);
  history.push({ role: 'user', content: text });

  const typing = addMessage('agent', '');
  typing.querySelector('.bubble').innerHTML = '<span class="typing">querying boards…</span>';

  const submitBtn = form.querySelector('button');
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    typing.querySelector('.bubble').textContent = data.reply;
    history.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    typing.querySelector('.bubble').textContent = `⚠ ${err.message}`;
  } finally {
    submitBtn.disabled = false;
    input.focus();
  }
});

renderSuggestions();
checkStatus();
addMessage('agent', "I'm connected to the Deals and Work Orders boards. Ask me about pipeline health, sector performance, execution status, or billing — or tap a suggestion below.");
