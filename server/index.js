const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const gameManager = new GameManager();

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0 }));
app.use(express.json({ limit: '10mb' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

setInterval(() => gameManager.cleanupOldRooms(), 1800000);

io.on('connection', (socket) => {

  socket.on('create-room', () => {
    const code = gameManager.createRoom(socket.id);
    socket.join(code);
    socket.emit('room-created', { code, adminSocketId: socket.id });
  });

  socket.on('join-room', ({ roomCode, nickname }) => {
    if (!nickname || !nickname.trim()) {
      return socket.emit('error', { message: 'Nickname is required' });
    }
    const result = gameManager.joinRoom(roomCode, socket.id, nickname.trim());
    if (result.error) {
      return socket.emit('error', { message: result.error });
    }
    socket.join(roomCode);
    socket.emit('room-joined', {
      playerId: result.player.id,
      playerName: result.player.name,
      roomCode,
    });
    const room = gameManager.getRoom(roomCode);
    if (room) {
      const players = Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
      }));
      io.to(room.adminSocketId).emit('player-list', { players });
    }
  });

  socket.on('set-images', ({ roomCode, images }) => {
    const room = gameManager.getRoom(roomCode);
    if (!room || room.adminSocketId !== socket.id) return;
    if (!Array.isArray(images) || images.length === 0 || images.length > 5) return;
    gameManager.setImages(roomCode, images);
    socket.emit('images-set', { count: images.length });
  });

  socket.on('set-timer', ({ roomCode, timeLimit }) => {
    const room = gameManager.getRoom(roomCode);
    if (!room || room.adminSocketId !== socket.id) return;
    gameManager.setTimer(roomCode, timeLimit);
  });

  socket.on('start-game', ({ roomCode }) => {
    const room = gameManager.getRoom(roomCode);
    if (!room || room.adminSocketId !== socket.id) return;
    const result = gameManager.startGame(roomCode);
    if (result.error) {
      return socket.emit('error', { message: result.error });
    }
    io.to(roomCode).emit('game-started', {
      timeLimit: result.timeLimit,
      imageData: result.imageData,
    });
    let remaining = room.timeLimit;
    room.timerInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        const results = gameManager.endGame(roomCode, null);
        if (results) {
          io.to(roomCode).emit('game-over', { results });
        }
      } else {
        io.to(roomCode).emit('timer-tick', remaining);
      }
    }, 1000);
  });

  socket.on('finish-game', ({ roomCode }) => {
    const room = gameManager.getRoom(roomCode);
    if (!room || room.adminSocketId !== socket.id) return;
    const results = gameManager.finishGameEarly(roomCode);
    if (results) {
      io.to(roomCode).emit('game-over', { results });
    }
  });

  socket.on('swipe-stroke', ({ roomCode, strokePoints }) => {
    const progress = gameManager.processStroke(roomCode, socket.id, strokePoints);
    if (progress === null) return;
    socket.emit('progress-update', { progress });
    const winnerId = gameManager.checkWinner(roomCode);
    if (winnerId) {
      const room = gameManager.getRoom(roomCode);
      if (room && room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }
      const results = gameManager.endGame(roomCode, winnerId);
      if (results) {
        io.to(roomCode).emit('game-over', { results });
      }
    }
  });

  socket.on('play-again', ({ roomCode }) => {
    const room = gameManager.getRoom(roomCode);
    if (!room || room.adminSocketId !== socket.id) return;
    gameManager.resetRoom(roomCode);
    const players = Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
    }));
    io.to(room.adminSocketId).emit('player-list', { players });
    io.to(roomCode).emit('room-reset');
  });

  socket.on('disconnect', () => {
    for (const [code, room] of gameManager.rooms) {
      if (room.adminSocketId === socket.id) {
        io.to(code).emit('admin-disconnected');
        if (room.timerInterval) {
          clearInterval(room.timerInterval);
        }
        gameManager.rooms.delete(code);
        break;
      }
      if (room.players.has(socket.id)) {
        gameManager.removePlayer(code, socket.id);
        const players = Array.from(room.players.values()).map(p => ({
          id: p.id,
          name: p.name,
        }));
        io.to(room.adminSocketId).emit('player-list', { players });
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SwipeRush running on http://localhost:${PORT}`);
});
