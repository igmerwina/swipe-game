const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:3000';
const SS_DIR = path.join(__dirname, '..', 'screenshots');

const wait = ms => new Promise(r => setTimeout(r, ms));

async function takeScreenshots() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  // 1. Home page
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await wait(1000);
  await page.screenshot({ path: path.join(SS_DIR, 'home.png'), fullPage: false });

  // 2. Admin lobby with mock data
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-admin-lobby').classList.add('active');
    document.getElementById('admin-room-code').textContent = 'ABCD';
    // Add fake players
    const list = document.getElementById('player-list');
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    list.innerHTML = players.map((name, i) => `
      <li class="player-item">
        <div class="player-avatar" style="background:${['#7c5cfc','#f472b6','#06d6a0','#f59e0b'][i]}">${name[0]}</div>
        <span class="player-name">${name}</span>
      </li>
    `).join('');
    document.getElementById('player-count').textContent = `(${players.length})`;
    // Add mock image thumbs
    const thumbs = document.getElementById('image-thumbs');
    thumbs.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const img = document.createElement('img');
      img.className = 'image-thumb';
      img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      thumbs.appendChild(img);
    }
    document.getElementById('image-count').textContent = '📸 3/5 images loaded';
    document.getElementById('image-upload').classList.add('has-image');
  });
  await wait(500);
  await page.screenshot({ path: path.join(SS_DIR, 'admin-lobby.png'), fullPage: false });

  // 3. Game view with scratch canvas mock
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-game').classList.add('active');
    document.getElementById('game-timer').textContent = '45';
    document.getElementById('progress-fill').style.width = '42%';
    document.getElementById('progress-label').textContent = '✨ 42%';
    // Draw something on canvas to simulate
    const canvas = document.getElementById('baseCanvas');
    const scratchCanvas = document.getElementById('scratchCanvas');
    if (canvas && scratchCanvas) {
      canvas.width = 300; canvas.height = 400;
      scratchCanvas.width = 300; scratchCanvas.height = 400;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#7c5cfc';
      ctx.fillRect(0, 0, 300, 400);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 32px Nunito';
      ctx.textAlign = 'center';
      ctx.fillText('🏖️', 150, 200);
      const sctx = scratchCanvas.getContext('2d');
      sctx.fillStyle = '#cccccc';
      sctx.fillRect(0, 0, 300, 400);
      sctx.clearRect(60, 80, 180, 240);
    }
  });
  await wait(500);
  await page.screenshot({ path: path.join(SS_DIR, 'game.png'), fullPage: false });

  // 4. Results podium
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-results').classList.add('active');
    // Fake results
    const results = [
      { name: 'Alice', progress: 0.97, rank: 1, isWinner: true },
      { name: 'Bob', progress: 0.82, rank: 2, isWinner: false },
      { name: 'Charlie', progress: 0.65, rank: 3, isWinner: false },
      { name: 'Diana', progress: 0.41, rank: 4, isWinner: false },
    ];
    // Show podium
    const showPodium = (index, data) => {
      const el = document.getElementById(`podium-${index}`);
      const nameEl = document.getElementById(`p${index}-name`);
      const barEl = document.getElementById(`p${index}-bar`);
      if (!data) { el.style.display = 'none'; return; }
      el.style.display = 'flex';
      nameEl.textContent = data.name;
      barEl.textContent = `${Math.round(data.progress * 100)}%`;
    };
    showPodium(1, results[0]);
    showPodium(2, results[1]);
    showPodium(3, results[2]);
    // Results list
    const list = document.getElementById('results-list');
    list.innerHTML = results.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `
        <div class="result-row">
          <span class="result-rank">${medal}</span>
          <span class="result-name">${r.name}</span>
          <span class="result-progress">${Math.round(r.progress * 100)}%</span>
          <div class="result-progress-bar">
            <div class="result-progress-fill" style="width:${Math.round(r.progress * 100)}%"></div>
          </div>
        </div>
      `;
    }).join('');
    // Add confetti
    const cc = document.getElementById('confetti-container');
    cc.innerHTML = '';
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = `${Math.random() * 100}%`;
      el.style.background = ['#7c5cfc','#f472b6','#06d6a0','#f59e0b'][Math.floor(Math.random() * 4)];
      el.style.width = `${4 + Math.random() * 6}px`;
      el.style.height = `${4 + Math.random() * 6}px`;
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      el.style.animationDuration = `${2 + Math.random() * 2}s`;
      cc.appendChild(el);
    }
  });
  await wait(500);
  await page.screenshot({ path: path.join(SS_DIR, 'results.png'), fullPage: false });

  await browser.close();
  console.log('Screenshots saved to', SS_DIR);
}

takeScreenshots().catch(err => { console.error(err); process.exit(1); });
