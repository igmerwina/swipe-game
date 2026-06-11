const GRID_SIZE = 30;
const REVEAL_THRESHOLD = 0.95;
const STORAGE_KEY = 'swiperush-theme';
const POLL_INTERVAL = 1000;

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const btn = $('theme-toggle');
  if (saved === 'dark') {
    document.documentElement.removeAttribute('data-theme');
    btn.textContent = '\u{1F319}';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    btn.textContent = '\u{2600}\u{FE0F}';
  }
}

function toggleTheme() {
  const html = document.documentElement;
  const btn = $('theme-toggle');
  if (html.getAttribute('data-theme') === 'light') {
    html.removeAttribute('data-theme');
    btn.textContent = '\u{1F319}';
    localStorage.setItem(STORAGE_KEY, 'dark');
  } else {
    html.setAttribute('data-theme', 'light');
    btn.textContent = '\u{2600}\u{FE0F}';
    localStorage.setItem(STORAGE_KEY, 'light');
  }
}

const $ = id => document.getElementById(id);

let roomCode = null;
let playerId = null;
let playerName = null;
let adminToken = null;
let isAdmin = false;
let gameActive = false;
let currentView = '';
let lastEventId = 0;
let pollTimer = null;
let scratchEngine = null;
let localTimer = null;
let _adminInitialized = false;
let uploadedImages = [];

const API_BASE = window.__SWIPE_API__ || '/api';

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $(`view-${viewId}`);
  if (el) el.classList.add('active');
  currentView = viewId;
}

async function api(method, path, data) {
  const opts = { method };
  if (data) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(data);
  }
  const res = await fetch(`${API_BASE}/${path}`, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollGameState, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollGameState() {
  if (!roomCode) return;
  try {
    const pid = playerId || '';
    const state = await api('GET', `poll?roomCode=${roomCode}&playerId=${pid}&since=${lastEventId}`);

    if (state.events && state.events.length > 0) {
      lastEventId = state.events[state.events.length - 1].id;
      for (const ev of state.events) {
        handleGameEvent(ev);
      }
    }

    if (state.state === 'playing' && state.remaining !== null && state.remaining !== undefined) {
      updateTimer(state.remaining);
    }

    if (isAdmin && state.players) {
      updatePlayerList(state.players);
    }

    if (isAdmin && state.players && currentView === 'admin-playing') {
      updateAdminProgress(state.players);
    }

    if (!isAdmin && currentView === 'game') {
      $('progress-fill').style.width = `${Math.min(Math.round(state.progress * 100), 100)}%`;
      $('progress-label').textContent = `\u2728 ${Math.round(state.progress * 100)}%`;
      if (scratchEngine) scratchEngine.progress = state.progress;
    }
  } catch (err) {
    if (err.message !== 'Room not found') {
      console.error('Poll error:', err);
    }
  }
}

function handleGameEvent(event) {
  switch (event.type) {
    case 'game-started': {
      const d = event.data;
      if (!isAdmin) {
        showView('game');
        initScratch(d.imageData);
      } else {
        showView('admin-playing');
      }
      $('game-timer').textContent = d.timeLimit;
      $('game-timer').className = 'timer';
      $('admin-timer').textContent = d.timeLimit;
      $('admin-timer').className = 'timer';
      if (!isAdmin) $('progress-fill').style.width = '0%';
      if (!isAdmin) $('progress-label').textContent = '\u2728 0%';
      gameActive = true;
      break;
    }
    case 'game-over': {
      endGame(event.data.results);
      break;
    }
    case 'room-reset': {
      resetForNewGame();
      break;
    }
  }
}

function resizeImage(img, maxDim) {
  let w = img.width, h = img.height;
  if (w > maxDim || h > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.floor(w * s); h = Math.floor(h * s);
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

    this.baseCtx.drawImage(img, 0, 0, w, h);

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
  }

  async flush() {
    if (this.batch.length === 0) return;
    const points = this.batch.splice(0);
    if (roomCode && playerId && gameActive) {
      try {
        const result = await api('POST', 'swipe', { roomCode, playerId, strokePoints: points });
        if (result.progress !== undefined) {
          this.progress = result.progress;
          $('progress-fill').style.width = `${Math.min(Math.round(result.progress * 100), 100)}%`;
          $('progress-label').textContent = `\u2728 ${Math.round(result.progress * 100)}%`;
        }
      } catch {}
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

  _onTouchEnd() {
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

  _onMouseUp() {
    this.isDrawing = false;
    this.lastPoint = null;
    this.flush();
  }

  destroy() {
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

function initHome() {
  showView('home');
  stopPolling();
  gameActive = false;
  isAdmin = false;
  roomCode = null;
  playerId = null;
  playerName = null;
  adminToken = null;
  lastEventId = 0;

  $('btn-create').onclick = async () => {
    try {
      const data = await api('POST', 'create-room');
      roomCode = data.roomCode;
      adminToken = data.adminToken;
      isAdmin = true;
      playerId = adminToken;
      lastEventId = 0;
      startPolling();
      initAdminLobby();
    } catch (err) {
      alert(err.message);
    }
  };

  $('btn-join').onclick = async () => {
    const code = $('input-code').value.trim().toUpperCase();
    const name = $('input-name').value.trim();
    if (!code) { $('input-code').focus(); return; }
    if (!name) { $('input-name').focus(); return; }
    try {
      const data = await api('POST', 'join-room', { roomCode: code, nickname: name });
      playerId = data.playerId;
      playerName = data.playerName;
      roomCode = data.roomCode;
      isAdmin = false;
      lastEventId = 0;
      startPolling();
      showPlayerWaiting();
    } catch (err) {
      alert(err.message);
    }
  };

  $('input-code').onkeydown = (e) => { if (e.key === 'Enter') $('btn-join').click(); };
  $('input-name').onkeydown = (e) => { if (e.key === 'Enter') $('btn-join').click(); };
  $('input-code').oninput = function() {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  };
}

function initAdminLobby() {
  showView('admin-lobby');
  $('admin-room-code').textContent = roomCode;

  if (uploadedImages.length > 0) {
    showImageThumbs(uploadedImages);
  }
  syncStartButton();

  if (!_adminInitialized) {
    _adminInitialized = true;

    $('image-upload').onclick = () => $('image-input').click();

    $('image-input').onchange = async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      syncStartButton(true);

      if (files.some(f => f.type !== 'image/png')) {
        alert('Only PNG images are allowed!');
        e.target.value = '';
        syncStartButton();
        return;
      }

      let selected = files;
      if (selected.length > 5) {
        alert('Maximum 5 images allowed. Uploading first 5.');
        selected = selected.slice(0, 5);
      }

      const imageDataUrls = await Promise.all(selected.map(file => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => resolve(resizeImage(img, 600));
            img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        });
      }));

      uploadedImages = imageDataUrls;
      try {
        await api('POST', 'set-images', { roomCode, adminToken, images: imageDataUrls });
        showImageThumbs(imageDataUrls);
        syncStartButton();
      } catch (err) {
        alert(err.message);
        uploadedImages = [];
        syncStartButton();
      }
    };
  }

  $('timer-slider').oninput = () => {
    const val = $('timer-slider').value;
    $('timer-value').textContent = `${val}s`;
    api('POST', 'set-timer', { roomCode, adminToken, timeLimit: parseInt(val) }).catch(() => {});
  };

  $('btn-start').onclick = async () => {
    $('btn-start').disabled = true;
    try {
      const data = await api('POST', 'start-game', { roomCode, adminToken });
      gameActive = true;
      showView('admin-playing');
      $('admin-timer').textContent = data.timeLimit;
      $('admin-timer').className = 'timer';
    } catch (err) {
      alert(err.message);
      $('btn-start').disabled = false;
    }
  };

  $('btn-finish-game').onclick = async () => {
    try {
      await api('POST', 'finish-game', { roomCode, adminToken });
    } catch {}
  };
}

function syncStartButton(forceDisabled = false) {
  $('btn-start').disabled = forceDisabled || uploadedImages.length === 0;
}

function showImageThumbs(imageDataUrls) {
  const thumbsEl = $('image-thumbs');
  thumbsEl.innerHTML = '';
  imageDataUrls.forEach(url => {
    const img = document.createElement('img');
    img.className = 'image-thumb';
    img.src = url;
    thumbsEl.appendChild(img);
  });
  $('image-count').textContent = `\u{1F4F8} ${imageDataUrls.length}/5 images loaded`;
  $('image-upload').classList.add('has-image');
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

function updateAdminProgress(players) {
  const rows = $('admin-player-rows');
  if (!rows) return;
  rows.innerHTML = '';
  players.forEach((p, i) => {
    const pct = Math.round(p.progress * 100);
    const row = document.createElement('div');
    row.className = 'admin-player-row';
    row.innerHTML = `
      <span class="admin-player-name">${p.name}</span>
      <div class="admin-player-bar">
        <div class="admin-player-fill" style="width:${pct}%"></div>
      </div>
      <span class="admin-player-pct">${pct}%</span>
    `;
    rows.appendChild(row);
  });
}

function showPlayerWaiting() {
  showView('player-waiting');
  $('waiting-code').textContent = roomCode;
  $('waiting-name').textContent = playerName;
}

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

  scratchEngine.flushInterval = setInterval(() => {
    scratchEngine.flush();
  }, 250);
}

function updateTimer(remaining) {
  const timerEl = isAdmin ? $('admin-timer') : $('game-timer');
  if (!timerEl) return;
  timerEl.textContent = remaining;
  timerEl.className = 'timer';
  if (remaining <= 5) timerEl.classList.add('danger');
  else if (remaining <= 10) timerEl.classList.add('warn');
}

function endGame(results) {
  gameActive = false;
  stopPolling();
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
    const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : `${i + 1}.`;
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

function resetForNewGame() {
  gameActive = false;
  lastEventId = 0;
  startPolling();
  if (isAdmin) {
    showView('admin-lobby');
    if (uploadedImages.length > 0) {
      showImageThumbs(uploadedImages);
    }
    syncStartButton();
  } else {
    showPlayerWaiting();
  }
}

function resetToHome() {
  stopPolling();
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
  adminToken = null;
  lastEventId = 0;
  initHome();
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  $('theme-toggle').onclick = toggleTheme;
  initHome();

  $('btn-play-again').onclick = async () => {
    try {
      await api('POST', 'play-again', { roomCode, adminToken });
    } catch {}
  };

  $('btn-home').onclick = () => {
    resetToHome();
  };
});
