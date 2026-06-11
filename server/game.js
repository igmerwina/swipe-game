const { saveRoom, saveResults } = require('./db');

class GameManager {
  constructor() {
    this.rooms = new Map();
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  generateToken() {
    const b = () => Math.random().toString(36).substring(2, 10);
    return b() + b();
  }

  createRoom() {
    const code = this.generateCode();
    const adminToken = this.generateToken();
    const room = {
      code,
      adminToken,
      state: 'waiting',
      images: [],
      timeLimit: 60,
      players: new Map(),
      gridSize: 30,
      winner: null,
      startTime: null,
      createdAt: Date.now(),
      events: [],
      eventId: 0,
    };
    this.rooms.set(code, room);
    saveRoom(code, 'waiting');
    this.addEvent(code, 'room-created', {});
    return { code, adminToken };
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  addEvent(roomCode, type, data) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    const event = { id: ++room.eventId, type, data, ts: Date.now() };
    room.events.push(event);
    if (room.events.length > 200) room.events.splice(0, 100);
    return event;
  }

  getEventsSince(roomCode, lastId) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return room.events.filter(e => e.id > lastId);
  }

  joinRoom(code, playerName) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.state !== 'waiting') return { error: 'Game already started' };

    let name = playerName.trim().slice(0, 20);
    let suffix = 1;
    const names = new Set(Array.from(room.players.values()).map(p => p.name));
    while (names.has(name)) {
      suffix++;
      name = `${playerName.slice(0, 17)}${suffix}`;
    }

    const playerId = this.generateToken();
    const player = {
      id: playerId,
      name,
      progress: 0,
      grid: new Array(room.gridSize * room.gridSize).fill(false),
      finishedAt: null,
      joinedAt: Date.now(),
      lastPollAt: Date.now(),
    };
    room.players.set(playerId, player);
    this.addEvent(code, 'player-joined', { id: playerId, name });
    return { player: { id: playerId, name } };
  }

  removePlayer(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(playerId);
    if (player) {
      this.addEvent(roomCode, 'player-left', { id: playerId, name: player.name });
      room.players.delete(playerId);
    }
  }

  setImages(roomCode, images) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    room.images = images.slice(0, 5);
    this.addEvent(roomCode, 'images-set', { count: room.images.length });
    return true;
  }

  setTimer(roomCode, timeLimit) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    room.timeLimit = Math.max(15, Math.min(120, Math.floor(timeLimit)));
    return true;
  }

  startGame(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.players.size === 0) return { error: 'No players in room' };
    if (room.images.length === 0) return { error: 'No images uploaded' };
    if (room.state !== 'waiting') return { error: 'Game already started or ended' };

    room.state = 'playing';
    room.startTime = Date.now();
    room.winner = null;

    for (const player of room.players.values()) {
      player.grid = new Array(room.gridSize * room.gridSize).fill(false);
      player.progress = 0;
      player.finishedAt = null;
    }

    const randomIndex = Math.floor(Math.random() * room.images.length);
    const imageData = room.images[randomIndex];
    this.addEvent(roomCode, 'game-started', { timeLimit: room.timeLimit, imageData });
    return { success: true, timeLimit: room.timeLimit, imageData };
  }

  processStroke(roomCode, playerId, strokePoints) {
    const room = this.rooms.get(roomCode);
    if (!room || room.state !== 'playing') return null;

    const player = room.players.get(playerId);
    if (!player || player.finishedAt) return null;

    if (Date.now() - room.startTime > room.timeLimit * 1000) {
      return null;
    }

    const gridSize = room.gridSize;
    const cells = new Set();

    for (let i = 0; i < strokePoints.length - 1; i++) {
      const p1 = strokePoints[i];
      const p2 = strokePoints[i + 1];
      const lineCells = this.getLineCells(p1.x, p1.y, p2.x, p2.y, gridSize);
      lineCells.forEach(c => cells.add(c));
    }

    for (const p of strokePoints) {
      const col = p.x === undefined ? 0 : Math.floor(p.x * gridSize);
      const row = p.y === undefined ? 0 : Math.floor(p.y * gridSize);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr;
          const c = col + dc;
          if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
            cells.add(r * gridSize + c);
          }
        }
      }
    }

    cells.forEach(c => { player.grid[c] = true; });

    const revealed = player.grid.filter(Boolean).length;
    player.progress = revealed / (gridSize * gridSize);
    return player.progress;
  }

  getLineCells(x1n, y1n, x2n, y2n, gridSize) {
    const cells = new Set();
    let x0 = Math.floor(x1n * gridSize);
    let y0 = Math.floor(y1n * gridSize);
    const x1 = Math.floor(x2n * gridSize);
    const y1 = Math.floor(y2n * gridSize);

    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
      if (x0 >= 0 && x0 < gridSize && y0 >= 0 && y0 < gridSize) {
        cells.add(y0 * gridSize + x0);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }

    return cells;
  }

  checkWinner(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    for (const [id, player] of room.players) {
      if (player.progress >= 0.95) {
        return id;
      }
    }
    return null;
  }

  endGame(roomCode, winnerId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.state === 'finished') return null;
    room.state = 'finished';
    room.winner = winnerId;

    const sorted = Array.from(room.players.values())
      .sort((a, b) => {
        if (Math.abs(a.progress - b.progress) > 0.001) {
          return b.progress - a.progress;
        }
        return (a.finishedAt || Infinity) - (b.finishedAt || Infinity);
      });

    const results = sorted.map((p, i) => ({
      name: p.name,
      progress: p.progress,
      rank: i + 1,
      isWinner: p.id === winnerId,
    }));

    saveRoom(roomCode, 'finished');
    saveResults(roomCode, results);
    this.addEvent(roomCode, 'game-over', { results });

    return results;
  }

  finishGameEarly(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.state !== 'playing') return null;
    return this.endGame(roomCode, null);
  }

  resetRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    room.state = 'waiting';
    room.winner = null;
    room.startTime = null;
    for (const player of room.players.values()) {
      player.grid = new Array(room.gridSize * room.gridSize).fill(false);
      player.progress = 0;
      player.finishedAt = null;
    }
    this.addEvent(roomCode, 'room-reset', {});
    return true;
  }

  cleanupOldRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > 3600000) {
        this.rooms.delete(code);
      }
    }
  }

  getPollState(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    let remaining = null;
    if (room.state === 'playing' && room.startTime) {
      const elapsed = (Date.now() - room.startTime) / 1000;
      remaining = Math.max(0, Math.ceil(room.timeLimit - elapsed));
    }

    const player = room.players.get(playerId);
    const progress = player ? player.progress : 0;

    const players = Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      progress: p.progress,
    }));

    return { state: room.state, players, remaining, progress };
  }
}

module.exports = GameManager;
