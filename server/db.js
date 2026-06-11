const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, '..', 'data', 'games.json');
const dir = path.dirname(DATA_FILE);
try {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch {} // read-only filesystem (e.g., Vercel) — persistence is best-effort

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch {}
  return { rooms: [], results: [] };
}

function save(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch {} // read-only filesystem — persistence is best-effort
}

function saveRoom(roomCode, state) {
  const data = load();
  const existing = data.rooms.find(r => r.code === roomCode);
  if (existing) {
    existing.state = state;
    existing.endedAt = state === 'finished' ? new Date().toISOString() : null;
  } else {
    data.rooms.push({
      id: uuidv4(),
      code: roomCode,
      state,
      createdAt: new Date().toISOString(),
      endedAt: null,
    });
  }
  save(data);
}

function saveResults(roomCode, players) {
  const data = load();
  const saved = players.map(p => ({
    id: uuidv4(),
    roomCode,
    playerName: p.name,
    progress: Math.round(p.progress * 100) / 100,
    rank: p.rank,
    finishedAt: new Date().toISOString(),
  }));
  data.results.push(...saved);
  save(data);
}

module.exports = { saveRoom, saveResults };
