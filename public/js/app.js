// ============================================
// SwipeRush — Client Application
// ============================================

const GRID_SIZE = 30;
const REVEAL_THRESHOLD = 0.95;

const STORAGE_KEY = 'swiperush-theme';

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const btn = $('theme-toggle');
  if (saved === 'dark') {
    document.documentElement.removeAttribute('data-theme');
    btn.textContent = '🌙';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    btn.textContent = '☀️';
  }
}

function toggleTheme() {
  const html = document.documentElement;
  const btn = $('theme-toggle');
  if (html.getAttribute('data-theme') === 'light') {
    html.removeAttribute('data-theme');
    btn.textContent = '🌙';
    localStorage.setItem(STORAGE_KEY, 'dark');
  } else {
    html.setAttribute('data-theme', 'light');
    btn.textContent = '☀️';
    localStorage.setItem(STORAGE_KEY, 'light');
  }
}

let socket = null;
let roomCode = null;
let playerId = null;
let playerName = null;
let isAdmin = false;
let currentView = '';
let gameActive = false;
let scratchEngine = null;
let flushInterval = null;
let _adminInitialized = false;
let uploadedImages = [];

const $ = id => document.getElementById(id);

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $(`view-${viewId}`);
  if (el) el.classList.add('active');
  currentView = viewId;
}

// ---- Utility ----
function resizeImage(img, maxDim) {
  let w = img.width, h = img.height;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.floor(w * scale); h = Math.floor(h * scale);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}

const AVATAR_COLORS = [
  '#7c5cfc','#f472b6','#06d6a0','#f59e0b','#ef4444','#10b981',
  '#60a5fa','#e84393','#a78bfa','#34d399','#fbbf24','#fb923c'
];

function getAvatarColor(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

// ---- Confetti ----
function spawnConfetti() {
  const container = $('confetti-container');
  container.innerHTML = '';
  const colors = ['#7c5cfc','#f472b6','#06d6a0','#f59e0b','#FFD700','#ef4444','#a78bfa','#10b981'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.width = `${4 + Math.random() * 6}px`;
    el.style.height = `${4 + Math.random() * 6}px`;
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    el.style.animationDuration = `${2 + Math.random() * 2}s`;
    el.style.animationDelay = `${Math.random() * 1.5}s`;
    container.appendChild(el);
  }
  setTimeout(() => container.innerHTML = '', 5000);
}

// ============================================
//  SCRATCH ENGINE
// ============================================
class ScratchEngine {
  constructor(baseCanvasId, scratchCanvasId, imageSrc) {
    this.baseCanvas = $(baseCanvasId);
    this.scratchCanvas = $(scratchCanvasId);
    this.baseCtx = this.baseCanvas.getContext('2d');
    this.scratchCtx = this.scratchCanvas.getContext('2d', { willReadFrequently: false });
    this.imageSrc = imageSrc;
    this.image = null;
    this.initialized = false;
    this.progress = 0;
    this.revealed = false;
    this.batch = [];
    this.lastPoint = null;
    this.isDrawing = false;
    this.dimensions = { w: 0, h: 0 };

    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    this._loadImage();
  }

  _loadImage() {
    const img = new Image();
    img.onload = () => {
      this.image = img;
      this._initCanvases();
    };
    img.src = this.imageSrc;
  }

  _initCanvases() {
    const img = this.image;
    const stack = $('canvas-stack');
    const cw = stack.clientWidth;
    const ch = stack.clientHeight;

    if (cw === 0 || ch === 0) {
      requestAnimationFrame(() => this._initCanvases());
      return;
    }

    const maxDim = 600;
    const aspect = img.width / img.height;
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.floor(w * s); h = Math.floor(h * s);
    }

    this.dimensions = { w, h };
    this.baseCanvas.width = w;
    this.baseCanvas.height = h;
    this.scratchCanvas.width = w;
    this.scratchCanvas.height = h;

    let displayW, displayH;
    if (aspect > cw / ch) { displayW = cw; displayH = cw / aspect; }
    else { displayH = ch; displayW = ch * aspect; }

    this.baseCanvas.style.width = `${displayW}px`;
    this.baseCanvas.style.height = `${displayH}px`;
    this.baseCanvas.style.left = `${(cw - displayW) / 2}px`;
    this.baseCanvas.style.top = `${(ch - displayH) / 2}px`;
    this.scratchCanvas.style.width = `${displayW}px`;
    this.scratchCanvas.style.height = `${displayH}px`;
    this.scratchCanvas.style.left = `${(cw - displayW) / 2}px`;
    this.scratchCanvas.style.top = `${(ch - displayH) / 2}px`;

    // Draw base canvas (clear image)
    this.baseCtx.drawImage(img, 0, 0, w, h);

    // Create blurred overlay using offscreen canvas technique
    // This works reliably across all browsers
    const blurFactor = 0.05;
    const smallW = Math.max(2, Math.floor(w * blurFactor));
    const smallH = Math.max(2, Math.floor(h * blurFactor));

    const offscreen = document.createElement('canvas');
    offscreen.width = smallW;
    offscreen.height = smallH;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(img, 0, 0, smallW, smallH);

    this.scratchCtx.imageSmoothingEnabled = true;
    this.scratchCtx.drawImage(offscreen, 0, 0, w, h);
    this.scratchCtx.globalCompositeOperation = 'destination-out';

    this.scratchCanvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    this.scratchCanvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this.scratchCanvas.addEventListener('touchend', this._onTouchEnd);
    this.scratchCanvas.addEventListener('touchcancel', this._onTouchEnd);
    this.scratchCanvas.addEventListener('mousedown', this._onMouseDown);
    this.scratchCanvas.addEventListener('mousemove', this._onMouseMove);
    this.scratchCanvas.addEventListener('mouseup', this._onMouseUp);
    this.scratchCanvas.addEventListener('mouseleave', this._onMouseUp);

    this.initialized = true;
  }

  getCanvasCoords(clientX, clientY) {
    const rect = this.scratchCanvas.getBoundingClientRect();
    const scaleX = this.scratchCanvas.width / rect.width;
    const scaleY = this.scratchCanvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  getNormalized(x, y) {
    return {
      x: x / this.scratchCanvas.width,
      y: y / this.scratchCanvas.height,
    };
  }

  _drawStroke(x1, y1, x2, y2) {
    const brushSize = Math.min(this.scratchCanvas.width, this.scratchCanvas.height) * 0.045;
    this.scratchCtx.lineWidth = brushSize;
    this.scratchCtx.lineCap = 'round';
    this.scratchCtx.lineJoin = 'round';
    this.scratchCtx.beginPath();
    this.scratchCtx.moveTo(x1, y1);
    this.scratchCtx.lineTo(x2, y2);
    this.scratchCtx.stroke();
  }

  _addToBatch(x, y) {
    const n = this.getNormalized(x, y);
    this.batch.push(n);
    if (this.batch.length >= 30) this.flush();
  }

  flush() {
    if (this.batch.length === 0) return;
    const points = this.batch.splice(0);
    if (socket && roomCode && gameActive) {
      socket.emit('swipe-stroke', { roomCode, strokePoints: points });
    }
  }

  _onTouchStart(e) {
    e.preventDefault();
    const t = e.touches[0];
    const c = this.getCanvasCoords(t.clientX, t.clientY);
    this.isDrawing = true;
    this.lastPoint = c;
    this._drawStroke(c.x - 0.5, c.y - 0.5, c.x, c.y);
    this._addToBatch(c.x, c.y);
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (!this.isDrawing) return;
    const t = e.touches[0];
    const c = this.getCanvasCoords(t.clientX, t.clientY);
    if (this.lastPoint) {
      this._drawStroke(this.lastPoint.x, this.lastPoint.y, c.x, c.y);
    }
    this._addToBatch(c.x, c.y);
    this.lastPoint = c;
  }

  _onTouchEnd(e) {
    this.isDrawing = false;
    this.lastPoint = null;
    this.flush();
  }

  _onMouseDown(e) {
    const c = this.getCanvasCoords(e.clientX, e.clientY);
    this.isDrawing = true;
    this.lastPoint = c;
    this._drawStroke(c.x - 0.5, c.y - 0.5, c.x, c.y);
    this._addToBatch(c.x, c.y);
  }

  _onMouseMove(e) {
    if (!this.isDrawing) return;
    const c = this.getCanvasCoords(e.clientX, e.clientY);
    if (this.lastPoint) {
      this._drawStroke(this.lastPoint.x, this.lastPoint.y, c.x, c.y);
    }
    this._addToBatch(c.x, c.y);
    this.lastPoint = c;
  }

  _onMouseUp(e) {
    this.isDrawing = false;
    this.lastPoint = null;
    this.flush();
  }

  destroy() {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.scratchCanvas.removeEventListener('touchstart', this._onTouchStart);
    this.scratchCanvas.removeEventListener('touchmove', this._onTouchMove);
    this.scratchCanvas.removeEventListener('touchend', this._onTouchEnd);
    this.scratchCanvas.removeEventListener('touchcancel', this._onTouchEnd);
    this.scratchCanvas.removeEventListener('mousedown', this._onMouseDown);
    this.scratchCanvas.removeEventListener('mousemove', this._onMouseMove);
    this.scratchCanvas.removeEventListener('mouseup', this._onMouseUp);
    this.scratchCanvas.removeEventListener('mouseleave', this._onMouseUp);
  }
}

// ============================================
//  SOCKET SETUP
// ============================================
function connectSocket() {
  socket = io();

  socket.on('room-created', ({ code }) => {
    roomCode = code;
    isAdmin = true;
    initAdminLobby();
  });

  socket.on('room-joined', ({ playerId: pid, playerName: pname, roomCode: rc }) => {
    playerId = pid;
    playerName = pname;
    roomCode = rc;
    showPlayerWaiting();
  });

  socket.on('error', ({ message }) => {
    alert(message);
  });

  socket.on('player-list', ({ players }) => {
    updatePlayerList(players);
  });

  socket.on('images-set', ({ count }) => {
    $('btn-start').disabled = false;
    const label = $('image-count');
    if (count > 0) label.textContent = `📸 ${count}/5 images loaded`;
  });

  socket.on('game-started', ({ timeLimit, imageData }) => {
    startGame(timeLimit, imageData);
  });

  socket.on('timer-tick', (remaining) => {
    updateTimer(remaining);
  });

  socket.on('progress-update', ({ progress }) => {
    updateProgress(progress);
  });

  socket.on('game-over', ({ results }) => {
    endGame(results);
  });

  socket.on('room-reset', () => {
    resetForNewGame();
  });

  socket.on('admin-disconnected', () => {
    alert('Host disconnected. Game ended.');
    resetToHome();
  });
}

// ============================================
//  HOME VIEW
// ============================================
function initHome() {
  showView('home');
  gameActive = false;
  isAdmin = false;
  roomCode = null;
  playerId = null;
  playerName = null;

  $('btn-create').onclick = () => {
    socket.emit('create-room');
  };

  $('btn-join').onclick = () => {
    const code = $('input-code').value.trim().toUpperCase();
    const name = $('input-name').value.trim();
    if (!code) { $('input-code').focus(); return; }
    if (!name) { $('input-name').focus(); return; }
    socket.emit('join-room', { roomCode: code, nickname: name });
  };

  $('input-code').onkeydown = (e) => { if (e.key === 'Enter') $('btn-join').click(); };
  $('input-name').onkeydown = (e) => { if (e.key === 'Enter') $('btn-join').click(); };
  $('input-code').oninput = function() {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  };
}

// ============================================
//  ADMIN LOBBY
// ============================================
function initAdminLobby() {
  showView('admin-lobby');
  $('admin-room-code').textContent = roomCode;

  const uploadEl = document.getElementById('image-upload');
  const fileInput = $('image-input');
  const thumbsEl = $('image-thumbs');
  const countEl = $('image-count');

  // Re-display previously uploaded images if any
  if (uploadedImages.length > 0) {
    showImageThumbs(uploadedImages);
    $('btn-start').disabled = false;
  }

  if (!_adminInitialized) {
    _adminInitialized = true;

    uploadEl.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      if (files.some(f => f.type !== 'image/png')) {
        alert('Only PNG images are allowed!');
        fileInput.value = '';
        return;
      }

      let selected = files;
      if (selected.length > 5) {
        alert('Maximum 5 images allowed. Uploading first 5.');
        selected = selected.slice(0, 5);
      }

      Promise.all(selected.map(file => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
              resolve(resizeImage(img, 600));
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        });
      })).then((imageDataUrls) => {
        uploadedImages = imageDataUrls;
        socket.emit('set-images', { roomCode, images: imageDataUrls });
        showImageThumbs(imageDataUrls);
      });
    };
  }

  const timerSlider = $('timer-slider');
  const timerValue = $('timer-value');
  timerSlider.oninput = () => {
    const val = timerSlider.value;
    timerValue.textContent = `${val}s`;
    socket.emit('set-timer', { roomCode, timeLimit: parseInt(val) });
  };

  $('btn-start').onclick = () => {
    $('btn-start').disabled = true;
    socket.emit('start-game', { roomCode });
  };

  $('btn-finish-game').onclick = () => {
    socket.emit('finish-game', { roomCode });
  };
}

function showImageThumbs(imageDataUrls) {
  const thumbsEl = $('image-thumbs');
  const countEl = $('image-count');
  thumbsEl.innerHTML = '';
  imageDataUrls.forEach(url => {
    const img = document.createElement('img');
    img.className = 'image-thumb';
    img.src = url;
    thumbsEl.appendChild(img);
  });
  countEl.textContent = `📸 ${imageDataUrls.length}/5 images loaded`;
  document.getElementById('image-upload').classList.add('has-image');
}

function updatePlayerList(players) {
  const list = $('player-list');
  list.innerHTML = '';
  $('player-count').textContent = `(${players.length})`;
  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'player-item';
    li.innerHTML = `
      <div class="player-avatar" style="background:${getAvatarColor(i)}">${p.name[0].toUpperCase()}</div>
      <span class="player-name">${p.name}</span>
    `;
    list.appendChild(li);
  });
}

// ============================================
//  PLAYER WAITING
// ============================================
function showPlayerWaiting() {
  showView('player-waiting');
  $('waiting-code').textContent = roomCode;
  $('waiting-name').textContent = playerName;
}

// ============================================
//  GAME START
// ============================================
function startGame(timeLimit, imageData) {
  gameActive = true;

  if (!isAdmin) {
    showView('game');
    initScratch(imageData);
    $('game-timer').textContent = timeLimit;
    $('game-timer').className = 'timer';
    $('progress-fill').style.width = '0%';
    $('progress-label').textContent = '✨ 0%';
  } else {
    showView('admin-playing');
    $('admin-timer').textContent = timeLimit;
    $('admin-timer').className = 'timer';
  }
}

// ============================================
//  SCRATCH INIT
// ============================================
function initScratch(imageData) {
  if (scratchEngine) {
    scratchEngine.destroy();
    scratchEngine = null;
  }

  const stack = $('canvas-stack');
  if (stack.clientWidth === 0 || stack.clientHeight === 0) {
    requestAnimationFrame(() => initScratch(imageData));
    return;
  }

  scratchEngine = new ScratchEngine('baseCanvas', 'scratchCanvas', imageData);
  scratchEngine.onRevealed = () => {
    if (socket && roomCode) {
      socket.emit('swipe-stroke', { roomCode, strokePoints: [{ x: 0, y: 0 }] });
    }
  };

  scratchEngine.flushInterval = setInterval(() => {
    scratchEngine.flush();
  }, 250);
}

// ============================================
//  GAME UPDATES
// ============================================
function updateTimer(remaining) {
  const timerEl = isAdmin ? $('admin-timer') : $('game-timer');
  if (!timerEl) return;
  timerEl.textContent = remaining;
  timerEl.className = 'timer';
  if (remaining <= 5) timerEl.classList.add('danger');
  else if (remaining <= 10) timerEl.classList.add('warn');
}

function updateProgress(progress) {
  const pct = Math.round(progress * 100);
  const fill = $('progress-fill');
  const label = $('progress-label');
  if (fill) fill.style.width = `${Math.min(pct, 100)}%`;
  if (label) label.textContent = `✨ ${pct}%`;
  if (scratchEngine) scratchEngine.progress = progress;
}

// ============================================
//  GAME END
// ============================================
function endGame(results) {
  gameActive = false;
  if (scratchEngine) {
    scratchEngine.flush();
  }
  showView('results');
  showPodium(results);

  if (results.length >= 1) spawnConfetti();
  $('btn-play-again').style.display = isAdmin ? 'block' : 'none';
  $('btn-home').style.display = 'block';
}

function showPodium(results) {
  const top3 = results.slice(0, 3);

  const showPodium = (index, data) => {
    const el = $(`podium-${index}`);
    const nameEl = $(`p${index}-name`);
    const barEl = $(`p${index}-bar`);
    if (!data) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    nameEl.textContent = data.name;
    barEl.textContent = `${Math.round(data.progress * 100)}%`;
  };

  showPodium(1, top3[0]);
  showPodium(2, top3[1]);
  showPodium(3, top3[2]);

  const list = $('results-list');
  list.innerHTML = '';
  results.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'result-row';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    row.innerHTML = `
      <span class="result-rank">${medal}</span>
      <span class="result-name">${r.name}</span>
      <span class="result-progress">${Math.round(r.progress * 100)}%</span>
      <div class="result-progress-bar">
        <div class="result-progress-fill" style="width:${Math.round(r.progress * 100)}%"></div>
      </div>
    `;
    list.appendChild(row);
  });
}

// ============================================
//  RESET
// ============================================
function resetForNewGame() {
  gameActive = false;
  if (isAdmin) {
    showView('admin-lobby');
    $('btn-start').disabled = false;
    if (uploadedImages.length > 0) {
      showImageThumbs(uploadedImages);
    }
  } else {
    showPlayerWaiting();
  }
}

function resetToHome() {
  if (scratchEngine) {
    scratchEngine.destroy();
    scratchEngine = null;
  }
  _adminInitialized = false;
  uploadedImages = [];
  gameActive = false;
  isAdmin = false;
  roomCode = null;
  playerId = null;
  playerName = null;
  initHome();
}

// ============================================
//  INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  $('theme-toggle').onclick = toggleTheme;
  connectSocket();
  initHome();

  $('btn-play-again').onclick = () => {
    socket.emit('play-again', { roomCode });
  };

  $('btn-home').onclick = () => {
    if (scratchEngine) {
      scratchEngine.destroy();
      scratchEngine = null;
    }
    _adminInitialized = false;
    uploadedImages = [];
    if (socket) socket.close();
    connectSocket();
    initHome();
  };
});
