// The window scene: the picture at its own art-pixel size (405x260), a few things in it alive, and the cat.
// Scene.run({ L, cat: {landscape, portrait}, catFps, worldFps, rain, steam, landscape: {top}, portrait: {left} })
//   cat       Rig.timelines, one per layout; catFps > 0 poses the cat that many times a second (sprite-like)
//   worldFps  the same for the lights and the water
//   landscape/portrait  top / left = first art row / column shown (the view always covers; portrait is a
//             taller-than-wide viewport and shows a slice of the picture at full height)
// ?t=<seconds> freezes time. Everything is periodic in L.
(function () {
  const W = 405, H = 260, SILL = 211;
  const PANES = [[43, 118], [125, 201], [208, 286], [294, 368]], GT = 23, GB = 207;
  const qs = new URLSearchParams(location.search);
  const frozen = qs.has('t') ? parseFloat(qs.get('t')) : null;
  const TAU = Math.PI * 2;
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const load = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('cannot load ' + src)); im.src = src; });

  async function run(cfg) {
    const L = cfg.L;
    document.documentElement.style.cssText = document.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
    const view = document.createElement('canvas'); view.style.cssText = 'position:fixed;left:0;top:0;display:block';
    document.body.appendChild(view);
    const vg = view.getContext('2d');
    const nat = document.createElement('canvas'); nat.width = W; nat.height = H;
    const ng = nat.getContext('2d', { willReadFrequently: true });
    const big = document.createElement('canvas'), bg2 = big.getContext('2d');

    const bgIm = await load('bg.png');
    ng.drawImage(bgIm, 0, 0);
    const base = ng.getImageData(0, 0, W, H).data;

    // ---- what is where in the picture
    const glass = new Uint8Array(W * H);
    for (const [a, b] of PANES) for (let y = GT; y <= GB; y++) for (let x = a; x <= b; x++) {
      const i = 4 * (y * W + x);
      if (base[i] + base[i + 1] + base[i + 2] > 70) glass[y * W + x] = 1;          // not the lamp in front of it
    }
    // lit windows and red beacons of the city: small groups of pixels that can be switched off
    const kind = new Uint8Array(W * H);                       // 1 window light, 2 beacon, 3 reflection on the water
    for (let y = GT; y <= GB; y++) for (let x = 0; x < W; x++) {
      const j = y * W + x, i = 4 * j; if (!glass[j]) continue;
      const r = base[i], g = base[i + 1], b = base[i + 2];
      if (r > 150 && g < 100 && b < 110) kind[j] = 2;
      else if (r > 118 && g > 118 && Math.abs(r - b) < 34) kind[j] = y < 172 ? 1 : (y >= 181 ? 3 : 0);
    }
    // the colour a light leaves behind: the nearest unlit pixel on its row
    const off = new Uint8ClampedArray(base);
    for (let y = GT; y <= GB; y++) for (let x = 0; x < W; x++) {
      const j = y * W + x; if (!kind[j]) continue;
      let a = x, b = x;
      while (a > 0 && kind[y * W + a]) a--;
      while (b < W - 1 && kind[y * W + b]) b++;
      const s = 4 * (y * W + (glass[y * W + a] ? a : b));
      off[4 * j] = base[s]; off[4 * j + 1] = base[s + 1]; off[4 * j + 2] = base[s + 2];
    }
    const group = new Int32Array(W * H).fill(-1); let ng_ = 0; const gsize = [];
    for (let j0 = 0; j0 < W * H; j0++) {
      if (!(kind[j0] === 1 || kind[j0] === 2) || group[j0] >= 0) continue;
      const st = [j0]; group[j0] = ng_; let n = 0;
      while (st.length) {
        const j = st.pop(); n++;
        for (const d of [-1, 1, -W, W]) { const k = j + d; if (kind[k] === kind[j0] && group[k] < 0) { group[k] = ng_; st.push(k); } }
      }
      gsize.push(n); ng_++;
    }
    // each group's schedule: most windows stay lit; some go dark for a while, once a loop
    const sched = [];
    for (let g = 0; g < ng_; g++) {
      const h = hash(g, 1.7);
      sched.push(h < 0.16 && gsize[g] <= 14 ? { a: hash(g, 5.1) * L, d: 3 + hash(g, 9.3) * 9 } : null);
    }
    const lit = (g, j, t) => {
      if (kind[j] === 2) { const u = (t / L * Math.round(L / 2) + hash(g, 3.3)) % 1; return u < 0.62; }   // beacons: about 2 s
      const s = sched[g]; if (!s) return true;
      return ((t - s.a) % L + L) % L > s.d;
    };

    // ---- rain: streaks in the picture's own slant, each on a new lane every pass
    const drops = [];
    if (cfg.rain) for (let i = 0; i < cfg.rain; i++) {
      const near = i % 3 === 0;
      const cyc = Math.round(L / (near ? 0.55 + 0.25 * hash(i, 2) : 0.9 + 0.5 * hash(i, 2)));    // passes per loop
      drops.push({ cyc, ph: hash(i, 4), len: near ? 9 + 6 * hash(i, 6) : 4 + 4 * hash(i, 6), a: near ? 0.2 + 0.12 * hash(i, 8) : 0.09 + 0.07 * hash(i, 8) });
    }
    const SL = -0.3;                                             // x per y of a falling drop

    const cbuf = new Uint8Array(W * H);
    const COL = [null, [6, 9, 28], [15, 20, 47], [9, 12, 34]];
    const q = (t, fps) => fps ? Math.floor(t * fps + 1e-6) / fps : t;

    function render(t) {
      const id = ng.createImageData(W, H), d = id.data;
      d.set(base);
      const tw = q(t, cfg.worldFps);
      // lights
      for (let j = 0; j < W * H; j++) {
        const g = group[j];
        if (g >= 0 && !lit(g, j, tw)) { d[4 * j] = off[4 * j]; d[4 * j + 1] = off[4 * j + 1]; d[4 * j + 2] = off[4 * j + 2]; }
      }
      // the lamps' reflections wobble on the water: each row slides a pixel left or right, in a wave that runs down
      for (let y = 181; y <= GB; y++) {
        const o = Math.round(1.25 * Math.sin(TAU * (y / 9 - Math.round(L / 2.5) * tw / L)) * Math.min(1, (y - 180) / 4));
        if (!o) continue;
        for (let x = 1; x < W - 1; x++) {
          const j = y * W + x; if (!glass[j]) continue;
          const s = j - o;
          if (kind[s] === 3 && glass[s]) { d[4 * j] = base[4 * s]; d[4 * j + 1] = base[4 * s + 1]; d[4 * j + 2] = base[4 * s + 2]; }
          else if (kind[j] === 3) { d[4 * j] = off[4 * j]; d[4 * j + 1] = off[4 * j + 1]; d[4 * j + 2] = off[4 * j + 2]; }
        }
      }
      // rain
      for (let i = 0; i < drops.length; i++) {
        const dr = drops[i], u = t / L * dr.cyc + dr.ph, pass = Math.floor(u) % dr.cyc, f = u - Math.floor(u);
        const span = GB - GT + dr.len + 8;
        const y0 = GT - dr.len + f * span, x0 = 40 + hash(i * 7.3 + pass, 1.3) * 390 + SL * (y0 - GT);
        for (let k = 0; k < dr.len; k++) {
          const y = Math.round(y0 + k), x = Math.round(x0 + SL * k);
          if (y < GT || y > GB || x < 0 || x >= W) continue;
          const j = y * W + x; if (!glass[j]) continue;
          const a = dr.a * (0.35 + 0.65 * k / dr.len);
          d[4 * j] += (150 - d[4 * j]) * a; d[4 * j + 1] += (158 - d[4 * j + 1]) * a; d[4 * j + 2] += (205 - d[4 * j + 2]) * a;
        }
      }
      // steam off the mug
      if (cfg.steam) for (let i = 0; i < 7; i++) {
        const u = (t / L * Math.round(L / 4.5) + i / 7) % 1;
        const x = Math.round(177 + 2.5 * Math.sin(TAU * (u * 1.3 + hash(i, 2))) + (hash(i, 5) - 0.5) * 5), y = Math.round(220 - 27 * u);
        const a = 0.2 * Math.sin(Math.PI * u) * (1 - 0.5 * u);
        for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x; xx <= x + 1; xx++) {
          const j = 4 * (yy * W + xx);
          d[j] += (190 - d[j]) * a; d[j + 1] += (196 - d[j + 1]) * a; d[j + 2] += (190 - d[j + 2]) * a;
        }
      }
      // the cat
      const CAT = geo.portrait ? cfg.cat.portrait : cfg.cat.landscape;
      const tc = q(t, cfg.catFps), p = CAT.at(tc);
      if (p) {
        cbuf.fill(0);
        const step = cfg.catFps ? 1 / cfg.catFps : 0.03;
        Rig.draw(p, cbuf, W, H, k => CAT.at(tc - step * Math.round(k * 0.03 / step)), tc);
        for (let j = 0; j < W * H; j++) if (cbuf[j]) { const c = COL[cbuf[j]]; d[4 * j] = c[0]; d[4 * j + 1] = c[1]; d[4 * j + 2] = c[2]; }
      }
      ng.putImageData(id, 0, 0);
    }

    let geo = null;
    function layout() {
      const vw = innerWidth, vh = innerHeight;
      view.width = vw; view.height = vh; view.style.width = vw + 'px'; view.style.height = vh + 'px';
      const portrait = vh > vw, f = portrait ? (cfg.portrait || {}) : (cfg.landscape || {});
      const lw = vw, lh = vh;
      const s = Math.max(lw / W, lh / H), k = Math.ceil(s);
      big.width = W * k; big.height = H * k;
      const rows = lh / s, cols = lw / s;
      const top = Math.min(Math.max(f.top === undefined ? (H - rows) / 2 : f.top, 0), H - rows);
      const left = Math.min(Math.max(f.left === undefined ? (W - cols) / 2 : f.left, 0), W - cols);
      geo = { portrait, s, k, top, left, vw, vh };
    }
    function blit() {
      const { s, k, top, left } = geo;
      bg2.imageSmoothingEnabled = false; bg2.drawImage(nat, 0, 0, W * k, H * k);
      vg.imageSmoothingEnabled = true; vg.imageSmoothingQuality = 'high';
      vg.drawImage(big, -left * s, -top * s, W * s, H * s);
    }
    function frame() {
      const now = frozen !== null ? frozen : performance.now() / 1000;
      render(((now % L) + L) % L); blit();
      if (frozen === null) requestAnimationFrame(frame);
    }
    layout(); addEventListener('resize', () => { layout(); });
    frame(); window.__ready = true;
  }
  window.Scene = { run };
})();
