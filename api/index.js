const GameManager = require('../server/game');
const roomStore = require('../server/store');
require('../server/db');

const gameManager = new GameManager();
const DISCONNECT_TIMEOUT = 30000;

async function ensureRoom(code) {
  let room = gameManager.getRoom(code);
  if (!room) {
    const data = await roomStore.load(code);
    if (data) {
      gameManager.restoreRoom(data);
      room = data;
    }
  }
  return room;
}

async function persistRoom(code) {
  const room = gameManager.getRoom(code);
  if (room) {
    roomStore.save(code, room).catch(() => {});
  }
}

setInterval(() => gameManager.cleanupOldRooms(), 1800000);

setInterval(() => {
  for (const [code, room] of gameManager.rooms) {
    if (room.state === 'playing' && room.startTime) {
      const elapsed = Date.now() - room.startTime;
      if (elapsed >= room.timeLimit * 1000) {
        gameManager.endGame(code, null);
        persistRoom(code);
      }
    }
  }
}, 2000);

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of gameManager.rooms) {
    for (const [id, player] of room.players) {
      if (now - player.lastPollAt > DISCONNECT_TIMEOUT) {
        gameManager.removePlayer(code, id);
        persistRoom(code);
      }
    }
  }
}, 10000);

function send(res, data, status = 200) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (status === 204) return res.status(204).end();
  res.status(status).json(data);
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.method !== 'POST') return resolve({});
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, '', 204);

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/^\/api\//, '');

  if (req.method !== 'POST' && path !== 'poll' && path !== 'health') {
    return send(res, { error: 'Method not allowed' }, 405);
  }

  const body = req.method === 'POST' ? await parseBody(req) : {};

  try {
    switch (path) {
      case 'create-room': {
        const { code, adminToken } = gameManager.createRoom();
        await persistRoom(code);
        return send(res, { roomCode: code, adminToken });
      }

      case 'join-room': {
        const { roomCode, nickname } = body;
        if (!roomCode || !nickname || !nickname.trim()) {
          return send(res, { error: 'Invalid room code or nickname' }, 400);
        }
        const room = await ensureRoom(roomCode);
        if (!room) return send(res, { error: 'Room not found' }, 404);
        const result = gameManager.joinRoom(roomCode, nickname.trim());
        if (result.error) return send(res, { error: result.error }, 400);
        await persistRoom(roomCode);
        return send(res, { playerId: result.player.id, playerName: result.player.name, roomCode });
      }

      case 'set-images': {
        const { roomCode, adminToken, images } = body;
        const room = await ensureRoom(roomCode);
        if (!room || room.adminToken !== adminToken) return send(res, { error: 'Unauthorized' }, 403);
        if (!Array.isArray(images) || images.length === 0 || images.length > 5) {
          return send(res, { error: 'Invalid images' }, 400);
        }
        gameManager.setImages(roomCode, images);
        await persistRoom(roomCode);
        return send(res, { count: images.length });
      }

      case 'set-timer': {
        const { roomCode, adminToken, timeLimit } = body;
        const room = await ensureRoom(roomCode);
        if (!room || room.adminToken !== adminToken) return send(res, { error: 'Unauthorized' }, 403);
        gameManager.setTimer(roomCode, timeLimit);
        await persistRoom(roomCode);
        return send(res, { success: true });
      }

      case 'start-game': {
        const { roomCode, adminToken } = body;
        const room = await ensureRoom(roomCode);
        if (!room || room.adminToken !== adminToken) return send(res, { error: 'Unauthorized' }, 403);
        const result = gameManager.startGame(roomCode);
        if (result.error) return send(res, { error: result.error }, 400);
        await persistRoom(roomCode);
        return send(res, { timeLimit: result.timeLimit, imageData: result.imageData });
      }

      case 'swipe': {
        const { roomCode, playerId, strokePoints } = body;
        if (!roomCode || !playerId || !strokePoints) {
          return send(res, { error: 'Missing params' }, 400);
        }
        const room = await ensureRoom(roomCode);
        if (!room) return send(res, { progress: 0 });
        const progress = gameManager.processStroke(roomCode, playerId, strokePoints);
        if (progress === null) return send(res, { progress: 0 });
        const winnerId = gameManager.checkWinner(roomCode);
        if (winnerId) {
          gameManager.endGame(roomCode, winnerId);
        }
        await persistRoom(roomCode);
        return send(res, { progress });
      }

      case 'finish-game': {
        const { roomCode, adminToken } = body;
        const room = await ensureRoom(roomCode);
        if (!room || room.adminToken !== adminToken) return send(res, { error: 'Unauthorized' }, 403);
        const results = gameManager.finishGameEarly(roomCode);
        if (results) await persistRoom(roomCode);
        return send(res, { results });
      }

      case 'play-again': {
        const { roomCode, adminToken } = body;
        const room = await ensureRoom(roomCode);
        if (!room || room.adminToken !== adminToken) return send(res, { error: 'Unauthorized' }, 403);
        gameManager.resetRoom(roomCode);
        await persistRoom(roomCode);
        return send(res, { success: true });
      }

      case 'poll': {
        const roomCode = url.searchParams.get('roomCode');
        const playerId = url.searchParams.get('playerId');
        const since = parseInt(url.searchParams.get('since') || '0', 10);

        if (!roomCode) return send(res, { error: 'Missing roomCode' }, 400);

        const room = await ensureRoom(roomCode);
        if (!room) return send(res, { error: 'Room not found' }, 404);

        if (playerId) {
          const player = room.players.get(playerId);
          if (player) player.lastPollAt = Date.now();
        }

        const events = gameManager.getEventsSince(roomCode, since);
        const pollData = gameManager.getPollState(roomCode, playerId);

        if (!pollData) return send(res, { error: 'Room not found' }, 404);

        return send(res, { ...pollData, events });
      }

      case 'health': {
        return send(res, { ok: true, rooms: gameManager.rooms.size });
      }

      default:
        return send(res, { error: 'Not found' }, 404);
    }
  } catch (err) {
    console.error(err);
    return send(res, { error: 'Internal server error' }, 500);
  }
}

module.exports = handler;

if (!process.env.VERCEL) {
  const express = require('express');
  const path = require('path');
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.all('/api/*', handler);
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`SwipeRush running on http://localhost:${PORT}`);
  });
}
