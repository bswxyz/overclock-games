/* ============================================================
   OVERCLOCK — DIRGE PROTOCOL
   Everything hand-rolled: pixel renderer, CRT pipeline, devlog
   typer, konami code. Zero dependencies, on purpose.
   Progressive enhancement: page is fully readable without this.
   ============================================================ */
(() => {
  'use strict';

  const reduceQ = matchMedia('(prefers-reduced-motion: reduce)');
  const R = () => reduceQ.matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- seeded randomness ---------- */
  // mulberry32 — deterministic stream per scene, so every tick redraws
  // the exact same dungeon (only flames/fog consult the tick hash).
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // stateless hash for per-tick flicker (never disturbs the seeded stream)
  const hash = (a, b) => {
    let t = (a * 374761393 + b * 668265263) | 0;
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };

  /* ============================================================
     SPRITES — authored as ASCII maps, drawn as 1px rects
     ============================================================ */
  const drawMap = (ctx, map, colors, x, y, flip) => {
    for (let r = 0; r < map.length; r++) {
      const row = map[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        const col = colors[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + (flip ? row.length - 1 - c : c), y + r, 1, 1);
      }
    }
  };

  const KNIGHT_COLORS = {
    P: '#ff2ea6', H: '#c7d3e8', h: '#8093b8', V: '#0a0812',
    A: '#9fd8e4', a: '#55889c', L: '#37305a', B: '#4a4374',
    S: '#dfe8f4', G: '#ffb02e',
  };
  const KNIGHT_GOD = Object.assign({}, KNIGHT_COLORS, { P: '#ffb02e' });
  const K_BODY = [
    '....PP......',
    '...PHHHH....',
    '..PHHHHHH.S.',
    '..HHVVHH..S.',
    '..hHHHHh..S.',
    '...AAAA...S.',
    '..AAAAAA..S.',
    '..aAAAAA..S.',
    '..aAAAA.GGG.',
    '..LLLLLL..L.',
  ];
  const K_LEGS = [
    [ // stand
      '...LL..LL...',
      '...LL..LL...',
      '...LL..LL...',
      '..BBB..BBB..',
    ],
    [ // walk A — stride
      '...LL..LL...',
      '..LL...LL...',
      '..LL....LL..',
      '.BBB....BBB.',
    ],
    [ // walk B — passing
      '...LL..LL...',
      '....LLLL....',
      '....LL.LL...',
      '...BBB.BBB..',
    ],
  ];
  const drawKnight = (ctx, x, y, frame, flip, god) => {
    const colors = god ? KNIGHT_GOD : KNIGHT_COLORS;
    const bob = frame === 2 ? 1 : 0;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(x + 2, y + 14, 8, 1);
    drawMap(ctx, K_BODY, colors, x, y + bob, flip);
    drawMap(ctx, K_LEGS[frame], colors, x, y + 10 + bob, flip);
  };

  /* ============================================================
     DUNGEON RENDERER — one painter, many palettes
     ============================================================ */
  const PALETTES = {
    crypt: {
      dark: '#060312', wallHi: '#392a5e', wallLo: '#241a3e', mortar: '#150e26',
      floorHi: '#221839', floorLo: '#1a1230', crack: '#100a1c',
      accent: '#ff2ea6', accent2: '#29e6ff', torch: '#ffb02e', flame: '#ff7a3c',
      fog: '176,166,214',
    },
    flooded: {
      dark: '#04101c', wallHi: '#1e3a5c', wallLo: '#142a44', mortar: '#0b1a2c',
      floorHi: '#12283e', floorLo: '#0d2032', crack: '#081624',
      accent: '#29e6ff', accent2: '#7df9d9', torch: '#7df9d9', flame: '#29e6ff',
      fog: '150,200,230', water: '#0a3a52', shimmer: '#5cd9ff',
    },
    furnace: {
      dark: '#160806', wallHi: '#4a2118', wallLo: '#331612', mortar: '#1e0b08',
      floorHi: '#2a120c', floorLo: '#200d08', crack: '#150806',
      accent: '#ffb02e', accent2: '#ff5a3c', torch: '#ffb02e', flame: '#ff5a3c',
      fog: '255,150,80', lava: true,
    },
    garden: {
      dark: '#04140c', wallHi: '#1c4030', wallLo: '#122c20', mortar: '#0a1c12',
      floorHi: '#10281a', floorLo: '#0c2014', crack: '#081a10',
      accent: '#3cff9c', accent2: '#29e6ff', torch: '#3cff9c', flame: '#b8ffd9',
      fog: '140,255,190', vines: true,
    },
  };

  function paintDungeon(ctx, W, H, pal, seed, tick, knight) {
    const rnd = mulberry32(seed);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = pal.dark;
    ctx.fillRect(0, 0, W, H);

    const wallTop = Math.floor(H * 0.05);
    const wallY = Math.floor(H * 0.56);
    const bw = 12, bh = 6;

    // back wall — bricks over mortar
    ctx.fillStyle = pal.mortar;
    ctx.fillRect(0, wallTop, W, wallY - wallTop);
    for (let y = wallTop, row = 0; y < wallY - 1; y += bh, row++) {
      const off = row % 2 ? 6 : 0;
      for (let x = -bw; x < W; x += bw) {
        const v = rnd();
        const bx = x + off;
        ctx.fillStyle = v > 0.86 ? pal.wallHi : pal.wallLo;
        ctx.fillRect(bx + 1, y + 1, bw - 1, bh - 1);
        if (v > 0.96) { // rune brick, faint accent glow
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = pal.accent;
          ctx.fillRect(bx + 4, y + 2, 3, 3);
          ctx.globalAlpha = 1;
        }
      }
    }

    // doorway — an arch into the dark, with a breathing portal glow
    const doorW = 24;
    const cx = Math.floor(W / 2 + (rnd() - 0.5) * W * 0.22);
    const doorH = Math.min(34, wallY - wallTop - 6);
    const dx = cx - doorW / 2, dy = wallY - doorH;
    ctx.fillStyle = '#020108';
    ctx.fillRect(dx, dy + 4, doorW, doorH - 4);
    ctx.fillRect(dx + 3, dy + 2, doorW - 6, 2);
    ctx.fillRect(dx + 6, dy, doorW - 12, 2);
    const breathe = 0.16 + 0.1 * hash(tick >> 2, 99);
    ctx.globalAlpha = breathe;
    ctx.fillStyle = pal.accent;
    ctx.fillRect(cx - 4, dy + 8, 8, doorH - 8);
    ctx.globalAlpha = breathe * 0.6;
    for (let y = dy + 8; y < wallY; y += 2) ctx.fillRect(cx - 7, y, 14, 1);
    ctx.globalAlpha = 1;

    // floor — checkered flags with seeded cracks
    const tw = 16, th = 8;
    for (let y = wallY, row = 0; y < H - 8; y += th, row++) {
      for (let x = 0, col = 0; x < W; x += tw, col++) {
        ctx.fillStyle = (col + row) % 2 ? pal.floorLo : pal.floorHi;
        ctx.fillRect(x, y, tw, th);
        if (rnd() < 0.2) {
          ctx.fillStyle = pal.crack;
          const cxx = x + 2 + Math.floor(rnd() * (tw - 6));
          ctx.fillRect(cxx, y + 2 + Math.floor(rnd() * (th - 4)), 3, 1);
          ctx.fillRect(cxx + 2, y + 3 + Math.floor(rnd() * (th - 5)), 2, 1);
        }
      }
    }
    ctx.fillStyle = '#03020a';
    ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = pal.crack;
    ctx.fillRect(0, H - 8, W, 1);

    // torches — 8fps flames with dithered halos
    const torchXs = [Math.floor(W * 0.14), Math.floor(W * 0.86)];
    torchXs.forEach((tx, i) => {
      if (Math.abs(tx - cx) < doorW) return;
      const ty = wallY - Math.floor(H * 0.2);
      ctx.fillStyle = '#7a4a14';
      ctx.fillRect(tx, ty, 2, 5);
      ctx.fillStyle = '#4a2c0a';
      ctx.fillRect(tx - 1, ty + 4, 4, 2);
      const f = hash(tick, i * 7 + 1) > 0.5;
      ctx.fillStyle = pal.torch;
      ctx.fillRect(tx, ty - 3, 2, 3);
      ctx.fillRect(tx + (f ? -1 : 1), ty - 4, 2, 2);
      ctx.fillStyle = pal.flame;
      ctx.fillRect(tx + (f ? 1 : 0), ty - 2, 1, 2);
      // halo
      const rad = 7 + Math.floor(hash(tick, i * 13 + 5) * 3);
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = pal.torch;
      for (let oy = -rad; oy <= rad; oy++) {
        for (let ox = -rad; ox <= rad; ox++) {
          if (Math.abs(ox) + Math.abs(oy) > rad) continue;
          if ((ox + oy) % 2) continue;
          ctx.fillRect(tx + 1 + ox, ty - 2 + oy, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    });

    // crystals along the wall base
    const crystalPx = [[0, 2], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 1], [3, 2], [4, 2]];
    for (let i = 0; i < 3; i++) {
      const kx = Math.floor(8 + rnd() * (W - 20));
      if (Math.abs(kx - cx) < doorW) continue;
      const ky = wallY - 3;
      crystalPx.forEach(([px, py]) => {
        ctx.fillStyle = pal.accent;
        ctx.fillRect(kx + px, ky + py, 1, 1);
      });
      if (hash(tick, i * 31 + 2) > 0.75) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(kx + 2, ky, 1, 1);
      }
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = pal.accent;
      ctx.fillRect(kx - 3, ky - 2, 11, 7);
      ctx.globalAlpha = 1;
    }

    // furniture — chest + skull pile, seeded
    const chestX = Math.floor(W * (0.2 + rnd() * 0.5));
    ctx.fillStyle = '#5a3a16';
    ctx.fillRect(chestX, wallY + 6, 10, 6);
    ctx.fillStyle = '#3a2408';
    ctx.fillRect(chestX, wallY + 8, 10, 1);
    ctx.fillStyle = pal.torch;
    ctx.fillRect(chestX + 4, wallY + 8, 2, 2);
    const skX = Math.floor(W * (0.1 + rnd() * 0.75));
    ctx.fillStyle = '#b9b4c8';
    ctx.fillRect(skX, wallY + 12, 3, 2);
    ctx.fillRect(skX + 4, wallY + 13, 2, 1);
    ctx.fillStyle = pal.dark;
    ctx.fillRect(skX + 1, wallY + 13, 1, 1);

    // biome extras -------------------------------------------------
    if (pal.water) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = pal.water;
      ctx.fillRect(0, H - 22, W, 14);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pal.shimmer;
      for (let x = 0; x < W; x++) {
        if ((x + tick * 2) % 12 < 4) ctx.fillRect(x, H - 20, 1, 1);
        if ((x + 6 + tick) % 14 < 4) ctx.fillRect(x, H - 15, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (pal.lava) {
      for (let i = 0; i < 5; i++) {
        const lx = Math.floor(rnd() * (W - 14)) + 4;
        const ly = wallY + 4 + Math.floor(rnd() * (H - wallY - 16));
        ctx.globalAlpha = 0.35 + 0.5 * hash(tick >> 1, i * 17 + 3);
        ctx.fillStyle = pal.accent2;
        ctx.fillRect(lx, ly, 5, 1);
        ctx.fillRect(lx + 3, ly + 1, 4, 1);
        ctx.fillRect(lx + 6, ly, 3, 1);
        ctx.globalAlpha = 1;
      }
      for (let i = 0; i < 4; i++) { // rising embers
        const ex = Math.floor(10 + rnd() * (W - 20));
        const ey = H - 12 - ((tick * 2 + i * 23) % (H - 30));
        ctx.fillStyle = i % 2 ? pal.torch : pal.accent2;
        ctx.fillRect(ex + (hash(tick >> 1, i) > 0.5 ? 1 : 0), ey, 1, 1);
      }
    }
    if (pal.vines) {
      for (let i = 0; i < 5; i++) {
        const vx = Math.floor(6 + rnd() * (W - 12));
        const vlen = 8 + Math.floor(rnd() * 14);
        const sway = hash(tick >> 2, i * 11) > 0.5 ? 1 : 0;
        ctx.fillStyle = pal.accent;
        for (let y = 0; y < vlen; y++) {
          ctx.globalAlpha = y % 3 === 2 ? 0.9 : 0.55;
          ctx.fillRect(vx + (y > vlen / 2 ? sway : 0), wallTop + y, 1, 1);
          if (y % 4 === 1) ctx.fillRect(vx + 1 + (y > vlen / 2 ? sway : 0), wallTop + y, 1, 1);
        }
        ctx.globalAlpha = 1;
      }
      for (let i = 0; i < 6; i++) { // grass tufts
        const gx = Math.floor(rnd() * (W - 6)) + 2;
        const gy = wallY + 2 + Math.floor(rnd() * (H - wallY - 14));
        ctx.fillStyle = pal.accent;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(gx, gy, 1, 2);
        ctx.fillRect(gx + 2, gy + 1, 1, 1);
        ctx.globalAlpha = 1;
      }
    }

    // the knight
    if (knight) drawKnight(ctx, knight.x, knight.y, knight.frame, knight.flip, knight.god);

    // drifting fog dither (two layers, front of everything)
    for (let layer = 0; layer < 2; layer++) {
      const speed = layer ? 1 : 2;
      const off = (tick * speed) % 1000;
      ctx.fillStyle = `rgba(${pal.fog},${layer ? 0.07 : 0.05})`;
      for (let y = wallY + 4 + layer * 6; y < H - 6; y += 2) {
        for (let x = 0; x < W; x++) {
          if ((x + off + y * 3) % 7 === 0) ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    // HUD hearts — because it should feel like a game
    if (knight) {
      const hearts = knight.god ? 6 : 3;
      const hc = knight.god ? '#ffb02e' : '#ff2ea6';
      for (let i = 0; i < hearts; i++) {
        const hx = 4 + i * 7;
        ctx.fillStyle = hc;
        ctx.fillRect(hx, 4, 2, 2); ctx.fillRect(hx + 3, 4, 2, 2);
        ctx.fillRect(hx, 5, 5, 2); ctx.fillRect(hx + 1, 7, 3, 1);
        ctx.fillRect(hx + 2, 8, 1, 1);
      }
    }
  }

  /* ============================================================
     HERO SCENE — live loop, 8fps on purpose
     ============================================================ */
  let godMode = false;
  const heroCanvas = document.getElementById('heroScene');
  if (heroCanvas) {
    const ctx = heroCanvas.getContext('2d');
    const W = heroCanvas.width, H = heroCanvas.height;
    const knight = { x: 30, y: Math.floor(H * 0.56) + 6, frame: 0, flip: false, god: false, dir: 1, rest: 0 };
    let tick = 0, visible = true, last = 0, rafId = 0;

    const step = () => {
      tick++;
      if (knight.rest > 0) {
        knight.rest--;
        knight.frame = 0;
      } else {
        knight.x += knight.dir * 2;
        knight.frame = tick % 2 ? 1 : 2;
        if (knight.x > W - 34) { knight.dir = -1; knight.flip = true; knight.rest = 5; }
        if (knight.x < 14) { knight.dir = 1; knight.flip = false; knight.rest = 5; }
      }
      knight.god = godMode;
      paintDungeon(ctx, W, H, PALETTES.crypt, 7, tick, knight);
    };

    const loop = (t) => {
      rafId = requestAnimationFrame(loop);
      if (!visible) return;
      if (t - last >= 125) { last = t; step(); }
    };

    step(); // first frame immediately (also the reduced-motion static frame)
    if (!R()) rafId = requestAnimationFrame(loop);

    new IntersectionObserver((es) => {
      es.forEach((e) => { visible = e.isIntersecting; });
    }, { threshold: 0.05 }).observe(heroCanvas);

    reduceQ.addEventListener?.('change', () => {
      cancelAnimationFrame(rafId);
      if (!R()) rafId = requestAnimationFrame(loop);
    });
  }

  /* ============================================================
     SCREENS — same renderer, four palettes
     ============================================================ */
  const SHOTS = [
    { name: 'floor 01 — neon crypt · captured in-engine', pal: PALETTES.crypt, seed: 7, kx: 0.62 },
    { name: 'floor 03 — flooded archive · captured in-engine', pal: PALETTES.flooded, seed: 21, kx: 0.3 },
    { name: 'floor 05 — furnace deck · captured in-engine', pal: PALETTES.furnace, seed: 40, kx: 0.7 },
    { name: 'floor 07 — signal garden · captured in-engine', pal: PALETTES.garden, seed: 77, kx: 0.24 },
  ];
  const shotCanvas = document.getElementById('shotScene');
  const shotCaption = document.getElementById('shotCaption');
  const shotViewer = document.querySelector('.shot-viewer');
  const thumbs = Array.from(document.querySelectorAll('.shot-thumb'));
  const renderShot = (canvas, def, withKnight) => {
    const c = canvas.getContext('2d');
    const knight = withKnight
      ? { x: Math.floor(canvas.width * def.kx), y: Math.floor(canvas.height * 0.56) + 4, frame: 0, flip: def.kx > 0.5, god: false }
      : null;
    paintDungeon(c, canvas.width, canvas.height, def.pal, def.seed, def.seed % 5, knight);
  };
  if (shotCanvas) {
    renderShot(shotCanvas, SHOTS[0], true);
    thumbs.forEach((btn, i) => {
      const tCanvas = btn.querySelector('canvas');
      if (tCanvas) renderShot(tCanvas, SHOTS[i], false);
      btn.addEventListener('click', () => {
        thumbs.forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        const swap = () => {
          renderShot(shotCanvas, SHOTS[i], true);
          if (shotCaption) shotCaption.textContent = SHOTS[i].name;
          if (shotViewer) shotViewer.setAttribute('aria-label',
            `Large pixel-art screenshot of Dirge Protocol, ${SHOTS[i].name.split('·')[0].trim()}, rendered inside a CRT bezel.`);
        };
        if (R() || !shotViewer) { swap(); return; }
        shotViewer.classList.add('shot-flick');
        setTimeout(() => { swap(); shotViewer.classList.remove('shot-flick'); }, 110);
      });
    });
  }

  /* ============================================================
     PIXEL ICONS + CREW FACES — ASCII, like everything else
     ============================================================ */
  const ICON_COLORS = {
    M: '#ff2ea6', C: '#29e6ff', A: '#ffb02e', I: '#e8e4f0',
    D: '#665e80', d: '#37305a', S: '#e6b89c', s: '#c89078',
  };
  const ICONS = {
    floors: [
      'CCCC............',
      'C..C............',
      'C..CDDDD........',
      'CCCC...D........',
      '.......D........',
      '....MMMMMM......',
      '....M....M......',
      '....M....MDDDD..',
      '....MMMMMM...D..',
      '.............D..',
      '..........CCCCCC',
      '..........C....C',
      '..........C....C',
      '..........CCCCCC',
    ],
    skull: [
      '....IIIIIIII....',
      '...IIIIIIIIII...',
      '..IIIIIIIIIIII..',
      '..IIIIIIIIIIII..',
      '..II..IIII..II..',
      '..I.MM.II.MM.I..',
      '..I.MM.II.MM.I..',
      '..II..IIII..II..',
      '..IIIIIIIIIIII..',
      '...IIIIIIIIII...',
      '....I.I..I.I....',
      '....IIIIIIII....',
      '............A...',
      '...........AAA..',
      '............A...',
    ],
    synth: [
      '................',
      '......M.........',
      '..C...M...C.....',
      '..C...M...C.....',
      '..C.A.M.A.C..M..',
      '..C.A.M.A.C..M..',
      '..C.A.M.A.C..M..',
      '..C.A.M.A.C..M..',
      '..C.A.M.A.C..M..',
      '..C...M...C..M..',
      '..C...M...C..M..',
      '......M.........',
      '................',
    ],
    coop: [
      '................',
      '..MM.MM.........',
      '.MMMMMMM........',
      '.MMMMMMM..CC.CC.',
      '.MMMMMMM.CCCCCCC',
      '..MMMMM..CCCCCCC',
      '...MMM...CCCCCCC',
      '....M.....CCCCC.',
      '...........CCC..',
      '............C...',
      '................',
    ],
  };
  const FACES = {
    mara: [
      '....CCCCCCCC....',
      '...CCCCCCCCCC...',
      '..CCCCCCCCCCCC..',
      '..CCCCCCCCCCCC..',
      '..CCC.SSSS.CCC..',
      '..CC.SSSSSS.CC..',
      '..CC.SSSSSS.CC..',
      '..CCdDDdDDdCC...',
      '..CC.SSSSSS.CC..',
      '..CC.S.SS.S.CC..',
      '..C..SSSSSS..C..',
      '.....S....S.....',
      '......SSSS......',
      '....MMMMMMMM....',
      '...MMMMMMMMMM...',
      '...MM.MMMM.MM...',
    ],
    juno: [
      '.......MM.......',
      '......MMMM......',
      '......MMMM......',
      '..AA..MMMM..AA..',
      '.AAAAAAMMAAAAA..',
      '.AA..sMMMMs..AA.',
      '.CC.sssssass.CC.',
      '.CC.s.ss.s.s.CC.',
      '.CC.ssssssss.CC.',
      '.CC.s.s..s.s.CC.',
      '.....ssssss.....',
      '.....s....s.....',
      '......ssss......',
      '....dddddddd....',
      '...dddddddddd...',
      '...dd.dddd.dd...',
    ],
  };
  document.querySelectorAll('.cart-icon').forEach((cv) => {
    const map = ICONS[cv.dataset.icon];
    if (map) drawMap(cv.getContext('2d'), map, ICON_COLORS, 0, Math.floor((16 - map.length) / 2), false);
  });
  document.querySelectorAll('.crew-face').forEach((cv) => {
    const map = FACES[cv.dataset.face];
    if (map) drawMap(cv.getContext('2d'), map, ICON_COLORS, 0, 0, false);
  });

  /* ============================================================
     HERO INTRO + SCROLL REVEALS
     ============================================================ */
  const hero = document.querySelector('.hero');
  requestAnimationFrame(() => hero && hero.classList.add('loaded'));

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  /* ============================================================
     COUNTERS — chunky quantized steps, not smooth tweens
     ============================================================ */
  const cio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target, to = parseInt(el.dataset.to, 10);
      cio.unobserve(el);
      if (R()) { el.textContent = to.toLocaleString('en-US'); continue; }
      const dur = 900, t0 = performance.now();
      let lastDraw = 0;
      const frame = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        if (t - lastDraw >= 70 || p === 1) { // ~14fps: pixel-authentic
          lastDraw = t;
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(to * eased).toLocaleString('en-US');
        }
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
  }, { threshold: 0.5 });
  document.querySelectorAll('.s-num').forEach((el) => cio.observe(el));

  /* ---------- the deaths ticker — it's real, we keep dying ---------- */
  const deathEl = document.getElementById('deathCount');
  if (deathEl && !R()) {
    let deaths = 4217;
    const bump = () => {
      deaths += 1;
      deathEl.textContent = deaths.toLocaleString('en-US');
      setTimeout(bump, 5000 + Math.random() * 6000);
    };
    setTimeout(bump, 4500);
  }

  /* ============================================================
     DEVLOG — typed the hard way (visual layer only; a complete
     copy lives in .sr-only, and no-JS visitors get the prefill)
     ============================================================ */
  const termText = document.getElementById('termText');
  if (termText && !R()) {
    const lines = Array.from(termText.querySelectorAll('.tl'));
    const saved = lines.map((el) => ({
      el,
      html: el.innerHTML,
      text: el.textContent,
      isVer: el.classList.contains('tl-ver'),
      isCmd: el.classList.contains('tl-cmd'),
      isEnd: el.classList.contains('tl-end'),
      isGap: el.classList.contains('tl-gap'),
    }));
    let started = false;
    const typeAll = async () => {
      const pause = (ms) => new Promise((res) => setTimeout(res, ms));
      lines.forEach((el) => { el.innerHTML = ''; });
      for (const l of saved) {
        if (l.isGap) { await pause(140); continue; }
        if (l.isEnd) { l.el.innerHTML = l.html; break; }
        if (l.isVer) { l.el.innerHTML = l.html; await pause(180); continue; }
        l.el.classList.add('typing');
        const speed = l.isCmd ? 34 : 8;
        for (let i = 1; i <= l.text.length; i++) {
          l.el.textContent = l.text.slice(0, i);
          await pause(speed + (Math.random() < 0.06 ? 70 : 0));
        }
        l.el.classList.remove('typing');
        await pause(l.isCmd ? 320 : 90);
      }
    };
    new IntersectionObserver((es, obs) => {
      es.forEach((e) => {
        if (e.isIntersecting && !started) { started = true; obs.disconnect(); typeAll(); }
      });
    }, { threshold: 0.3 }).observe(termText);
  }

  /* ============================================================
     GLITCH SCHEDULER — scroll-section change only, ≥6s apart,
     never on focus, never with reduced motion
     ============================================================ */
  let lastGlitch = 0, currentSection = null, armed = false;
  setTimeout(() => { armed = true; }, 1500);
  const gio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.id || 'top';
      if (currentSection === null) { currentSection = id; continue; }
      if (id === currentSection) continue;
      currentSection = id;
      const now = performance.now();
      if (!armed || R() || document.hidden || now - lastGlitch < 6000) continue;
      lastGlitch = now;
      document.body.classList.add('is-glitching');
      setTimeout(() => document.body.classList.remove('is-glitching'), 140);
    }
  }, { threshold: 0.25 });
  document.querySelectorAll('[data-glitch]').forEach((s) => gio.observe(s));
  // a backgrounded tab suspends the cleanup timer — never let the glitch stick
  document.addEventListener('visibilitychange', () => document.body.classList.remove('is-glitching'));

  /* ============================================================
     KONAMI — ↑↑↓↓←→←→BA. harmless. probably.
     ============================================================ */
  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown',
    'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let kIdx = 0;
  const badge = document.getElementById('godBadge');
  addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase();
    kIdx = key === KONAMI[kIdx] ? kIdx + 1 : (key === KONAMI[0] ? 1 : 0);
    if (kIdx === KONAMI.length) {
      kIdx = 0;
      godMode = !godMode;
      document.body.classList.toggle('god', godMode);
      if (badge) {
        badge.hidden = !godMode;
        if (godMode) badge.textContent = '+ GOD MODE ON -- damage: yes. consequences: no.';
      }
    }
  });

  /* ============================================================
     RUN LOG FORM — demo-honest
     ============================================================ */
  const form = document.getElementById('runlogForm');
  const note = document.getElementById('formNote');
  if (form && note) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (!input) return;
      if (!input.value || !input.checkValidity()) {
        note.textContent = "that email reads like a mistyped cheat code. one more try?";
        note.className = 'runlog-note is-err';
        input.focus();
        return;
      }
      note.textContent = "you're in the party. welcome to the run log. (demo site — nothing was actually sent.)";
      note.className = 'runlog-note is-ok';
      form.querySelector('button').textContent = 'joined ✓';
      input.value = '';
    });
  }
})();
