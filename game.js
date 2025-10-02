// Coffee Flight - Daily Dogfight (mobile-first, seeded daily challenges)
// Uses canvas 2D, touch controls (left/right halves), bottom-center fire button.
// Stores best times and streak in localStorage.

(() => {
  // ----- Utilities -----
  const qs = s => document.querySelector(s);

  // seeded RNG (mulberry32)
  function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }

  // get daily seed string: e.g., "2025-10-02"
  function todayKey(date = new Date()) {
    return date.toISOString().slice(0,10);
  }

  // storage helpers
  const LS_BEST = 'coffee_bestTime';
  const LS_STREAK = 'coffee_streak';
  const LS_LAST_DONE = 'coffee_lastDone';

  // ----- Canvas & sizing -----
  const canvas = qs('#gameCanvas'), ctx = canvas.getContext('2d');
  function resize() {
    // maintain portrait-ish view within available area
    const wrap = canvas.parentElement;
    const w = Math.min(window.innerWidth - 24, 480);
    const h = Math.max(Math.round(w * 1.8), 600); // tall canvas for vertical feel
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ----- Game state -----
  const STATE = {
    running: false,
    startTime: 0,
    elapsed: 0,
    timeLimit: 20, // seconds for the daily challenge (tweakable)
    player: null,
    missiles: [],
    enemies: [],
    rng: Math.random,
    bestTime: null,
    streak: 0,
    lastDone: null,
    todaySeed: null,
    solvedToday: false
  };

  // ----- Player -----
  function createPlayer() {
    return {
      x: canvas.width / devicePixelRatio / 2,
      y: canvas.height / devicePixelRatio - 120,
      radius: 14,
      angle: 0, // -1 left, 1 right for visual tilt
      speed: 180, // px per second when turning (used to drift)
      vx: 0, vy: 0,
      cooldown: 0
    };
  }

  // ----- Enemies -----
  function createEnemy(type, x, y, params={}) {
    return Object.assign({
      id: Math.random().toString(36).slice(2,9),
      x, y, r: 12,
      hp: 1,
      type, // 'straight','zigzag','evasive','accelerator','swoop'
      state: 0,
      vx: 0, vy: 30 + Math.random()*30,
      params
    }, params);
  }

  // ----- Input -----
  let inputLeft = false, inputRight = false, firePressed = false;
  function setupControls() {
    // Touch / mouse for left/right half steering:
    function pointerDown(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      const w = rect.left + rect.width/2;
      if (x < w) { inputLeft = true; inputRight = false; }
      else { inputRight = true; inputLeft = false; }
    }
    function pointerUp(e){
      e.preventDefault();
      inputLeft = false; inputRight = false;
    }
    canvas.addEventListener('touchstart', pointerDown, {passive:false});
    canvas.addEventListener('touchend', pointerUp, {passive:false});
    canvas.addEventListener('mousedown', pointerDown);
    window.addEventListener('mouseup', pointerUp);

    // Fire button
    const fireBtn = qs('#fireBtn');
    fireBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); firePressed=true; }, {passive:false});
    fireBtn.addEventListener('touchend', (e)=>{ e.preventDefault(); firePressed=false; }, {passive:false});
    fireBtn.addEventListener('mousedown', () => firePressed = true);
    fireBtn.addEventListener('mouseup', () => firePressed = false);
  }

  // ----- Game logic -----
  function startDailyChallenge() {
    const seedStr = todayKey();
    STATE.todaySeed = seedStr;
    STATE.rng = mulberry32(hashStrToInt(seedStr));
    // deterministic enemy count and types
    const cnt = Math.floor(1 + STATE.rng()*7); // 1..7
    STATE.enemies = [];
    const width = canvas.width / devicePixelRatio;
    for (let i=0;i<cnt;i++) {
      const x = 40 + Math.floor(STATE.rng()*(width-80));
      const y = -40 - i*80; // staggered
      const t = pickEnemyType(STATE.rng());
      const e = createEnemy(t, x, y);
      // tweak parameters based on type & rng
      if (t==='zigzag') { e.params.amp = 30 + STATE.rng()*40; e.params.freq = 1 + STATE.rng()*1.5; }
      if (t==='evasive') { e.params.evadeSpeed = 80 + STATE.rng()*100; }
      if (t==='accelerator') { e.params.acc = 20 + STATE.rng()*40; e.vy = 20 + STATE.rng()*30; }
      if (t==='swoop') { e.params.swoop = 1 + STATE.rng()*2; e.vy = 40 + STATE.rng()*30; }
      STATE.enemies.push(e);
    }

    STATE.player = createPlayer();
    STATE.missiles = [];
    STATE.elapsed = 0;
    STATE.startTime = performance.now();
    STATE.running = true;
    STATE.solvedToday = false;

    // load local best/streak
    const best = localStorage.getItem(LS_BEST);
    STATE.bestTime = best ? parseFloat(best) : null;
    STATE.streak = parseInt(localStorage.getItem(LS_STREAK) || '0', 10);
    STATE.lastDone = localStorage.getItem(LS_LAST_DONE) || null;
    updateUI();
  }

  function pickEnemyType(rng) {
    const choice = rng();
    if (choice < 0.28) return 'straight';
    if (choice < 0.52) return 'zigzag';
    if (choice < 0.72) return 'evasive';
    if (choice < 0.88) return 'accelerator';
    return 'swoop';
  }

  function hashStrToInt(s) {
    // simple hash -> int for seed
    let h = 2166136261 >>> 0;
    for (let i=0;i<s.length;i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // missiles & firing
  function fireMissile(sender) {
    if (!sender || sender.cooldown > 0) return;
    sender.cooldown = 0.5; // half-second cooldown
    STATE.missiles.push({
      x: sender.x,
      y: sender.y - 20,
      vy: -380,
      r: 4,
      owner: 'player'
    });
  }

  // update loop
  let lastFrame = performance.now();
  function step(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (STATE.running) {
      update(dt);
      render();
      requestAnimationFrame(step);
    }
  }

  function update(dt) {
    STATE.elapsed = (performance.now() - STATE.startTime)/1000;
    const timeLeft = STATE.timeLimit - STATE.elapsed;

    // update player turning
    const turnSpeed = 200; // px/sec lateral
    if (inputLeft) STATE.player.x -= turnSpeed*dt;
    if (inputRight) STATE.player.x += turnSpeed*dt;
    // clamp
    const width = canvas.width / devicePixelRatio;
    STATE.player.x = Math.max(24, Math.min(width-24, STATE.player.x));

    // cooldown
    STATE.player.cooldown = Math.max(0, STATE.player.cooldown - dt);
    if (firePressed) fireMissile(STATE.player);

    // missiles
    for (let i=STATE.missiles.length-1;i>=0;i--) {
      const m = STATE.missiles[i];
      m.y += m.vy*dt;
      if (m.y < -20 || m.y > canvas.height/devicePixelRatio + 20) STATE.missiles.splice(i,1);
    }

    // enemies AI and movement
    for (let ei=STATE.enemies.length-1; ei>=0; ei--) {
      const e = STATE.enemies[ei];
      // behavior by type
      if (e.type === 'straight') {
        e.y += e.vy * dt;
      } else if (e.type === 'zigzag') {
        e.state += dt * e.params.freq;
        e.x += Math.sin(e.state) * e.params.amp * dt;
        e.y += e.vy * dt;
      } else if (e.type === 'evasive') {
        // if missile close, try to dodge laterally
        let dodge = 0;
        for (const m of STATE.missiles) {
          if (m.owner==='player' && Math.abs(m.x-e.x) < 60 && m.y < e.y+80 && m.y > e.y-200) {
            dodge += (m.x < e.x ? 1 : -1);
          }
        }
        e.x += (dodge * (e.params.evadeSpeed * dt));
        e.y += e.vy * dt;
      } else if (e.type === 'accelerator') {
        e.vy += e.params.acc * dt;
        e.y += e.vy * dt;
      } else if (e.type === 'swoop') {
        e.state += dt * e.params.swoop;
        e.x += Math.sin(e.state) * 20 * dt * 60;
        e.y += e.vy * dt + Math.abs(Math.sin(e.state)) * 10;
      }

      // keep them in bounds a bit
      e.x = Math.max(20, Math.min(width-20, e.x));

      // check collision with missiles
      for (let mi = STATE.missiles.length-1; mi>=0; mi--) {
        const m = STATE.missiles[mi];
        const dx = m.x - e.x, dy = m.y - e.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < e.r + m.r + 2) {
          // hit
          STATE.enemies.splice(ei,1);
          STATE.missiles.splice(mi,1);
          break;
        }
      }

      // if enemy goes past bottom, remove it (counts as survive)
      if (e.y > canvas.height/devicePixelRatio + 40) {
        STATE.enemies.splice(ei,1);
      }
    }

    // win condition: all enemies destroyed
    if (STATE.enemies.length === 0 && !STATE.solvedToday) {
      STATE.solvedToday = true;
      finishChallenge(true);
    }

    // lose condition: time runs out
    if (STATE.elapsed >= STATE.timeLimit && !STATE.solvedToday) {
      finishChallenge(false);
    }
  }

  function finishChallenge(won) {
    STATE.running = false;
    const elapsed = Math.min(STATE.elapsed, STATE.timeLimit);
    const seed = STATE.todaySeed || todayKey();
    const lastDone = localStorage.getItem(LS_LAST_DONE) || null;
    const today = todayKey();

    let streak = parseInt(localStorage.getItem(LS_STREAK) || '0', 10);
    const prev = localStorage.getItem(LS_LAST_DONE);
    if (won) {
      // update best
      const best = parseFloat(localStorage.getItem(LS_BEST) || '0');
      if (!best || elapsed < best || best <= 0) {
        localStorage.setItem(LS_BEST, elapsed.toFixed(3));
        STATE.bestTime = elapsed;
      }
      // update streak (if last done was yesterday)
      if (prev === dayBefore(today)) {
        streak = streak + 1;
      } else if (prev === today) {
        // already done today (shouldn't happen) -> do nothing
      } else {
        streak = 1;
      }
      localStorage.setItem(LS_STREAK, String(streak));
      localStorage.setItem(LS_LAST_DONE, today);
      STATE.streak = streak;
      STATE.lastDone = today;

      qs('#result').classList.remove('hidden');
      qs('#result').innerHTML = `<strong>Success!</strong> Time: ${elapsed.toFixed(2)}s • Streak: ${streak}`;
    } else {
      // fail -> reset streak
      localStorage.setItem(LS_STREAK, '0');
      STATE.streak = 0;
      qs('#result').classList.remove('hidden');
      qs('#result').innerHTML = `<strong>Time up.</strong> Try again tomorrow.`;
    }
    updateUI();
  }

  function dayBefore(dateStr) {
    // dateStr YYYY-MM-DD
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0,10);
  }

  // ----- Rendering -----
  function render() {
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.clearRect(0,0,w,h);

    // background "scroll"
    ctx.fillStyle = '#041426';
    ctx.fillRect(0,0,w,h);

    // hud: time left
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(8,8,w-16,44);
    ctx.fillStyle = '#cfeff3';
    ctx.font = '14px system-ui';
    const timeLeft = Math.max(0, (STATE.timeLimit - STATE.elapsed)).toFixed(2);
    ctx.fillText(`Time left: ${timeLeft}s`, 18, 28);
    ctx.fillText(`Enemies: ${STATE.enemies.length}`, 18, 46);

    // player (simple triangle)
    const p = STATE.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = '#ffd89b';
    ctx.beginPath();
    ctx.moveTo(0,-18);
    ctx.lineTo(12,12);
    ctx.lineTo(-12,12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // missiles
    ctx.fillStyle = '#ffe6a8';
    for (const m of STATE.missiles) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI*2);
      ctx.fill();
    }

    // enemies
    for (const e of STATE.enemies) {
      ctx.save();
      ctx.translate(e.x,e.y);
      ctx.fillStyle = '#ff8f8f';
      // draw small diamond
      ctx.beginPath();
      ctx.moveTo(0,-e.r);
      ctx.lineTo(e.r,0);
      ctx.lineTo(0,e.r);
      ctx.lineTo(-e.r,0);
      ctx.closePath();
      ctx.fill();

      // type marker
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.fillText(e.type[0].toUpperCase(), -4, 4);
      ctx.restore();
    }
  }

  // ----- UI -----
  function updateUI() {
    qs('#bestTime').textContent = STATE.bestTime ? STATE.bestTime.toFixed(2)+'s' : '—';
    qs('#streak').textContent = STATE.streak || 0;
    if (!STATE.running) {
      qs('#playBtn').disabled = false;
    } else {
      qs('#playBtn').disabled = true;
      qs('#result').classList.add('hidden');
    }
  }

  // ----- Boot & handlers -----
  function init() {
    setupControls();
    // wire play button
    qs('#playBtn').addEventListener('click', () => {
      qs('#result').classList.add('hidden');
      startDailyChallenge();
      lastFrame = performance.now();
      requestAnimationFrame(step);
    });

    // restore best/streak
    const best = localStorage.getItem(LS_BEST);
    STATE.bestTime = best ? parseFloat(best) : null;
    STATE.streak = parseInt(localStorage.getItem(LS_STREAK) || '0', 10);
    STATE.lastDone = localStorage.getItem(LS_LAST_DONE) || null;
    updateUI();

    // quick start on first open
    // (optional) autoclick play to encourage onboarding:
    // qs('#playBtn').click();
  }

  init();
})();
