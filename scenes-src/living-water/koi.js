/* koi.js — procedural top-down koi: simulation + Canvas2D drawing.
   Design space is 1920x1080; callers set the canvas transform. Exposes global `Koi`. */
(function (global) {
  'use strict';
  var TAU = Math.PI * 2;
  var NODES = 28;                 // spine nodes per fish
  var POOL = { x: 980, y: 690 };  // centre of the lit pool in design space

  /* half-width profile of the body (s along total length, w in units of max half-width) */
  var PROF = [
    [0, 0], [0.006, 0.30], [0.02, 0.53], [0.045, 0.73], [0.08, 0.88], [0.12, 0.96],
    [0.17, 0.995], [0.23, 1.0], [0.30, 0.97], [0.37, 0.90], [0.44, 0.79], [0.51, 0.64],
    [0.58, 0.46], [0.64, 0.30], [0.70, 0.17], [0.75, 0.095], [0.80, 0.060], [0.85, 0.05]
  ];
  /* forked tail fin, (s, lateral in units of max half-width) */
  var TAIL = [
    [0.80, 0.06], [0.86, 0.20], [0.915, 0.50], [0.965, 0.86], [1.0, 1.02], [1.0, 1.02],
    [0.972, 0.60], [0.945, 0.22], [0.935, -0.05], [0.95, -0.36], [0.985, -0.80], [0.985, -0.80],
    [0.94, -0.62], [0.89, -0.34], [0.84, -0.13], [0.80, -0.06]
  ];

  function wrapPi(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* initial layout mirrors the source wallpaper: [headX, headY, headingDeg, length, depth, redEdge, homeX, homeY, homeR] */
  var LAYOUT = [
    [285, 243, -133, 215, 0.22, 0, 560, 430, 260],
    [405, 238, -114, 285, 0.30, 0, 600, 470, 280],
    [885, 437, -132, 205, 0.55, 1, 1000, 640, 400],
    [1005, 468, -137, 335, 0.86, 1, 1040, 640, 380],
    [728, 697, -139, 215, 0.50, 0, 930, 700, 400],
    [703, 785, -137, 325, 0.66, 0, 900, 720, 420],
    [895, 770, -141, 300, 0.97, 1, 1000, 700, 360],
    [1020, 787, -102, 310, 0.90, 1, 1050, 720, 380],
    [885, 850, -139, 215, 0.60, 0, 960, 760, 400],
    [1362, 875, -52, 175, 0.28, 0, 1330, 860, 260]
  ];
  var ORANGE = [977, 635, -139, 232, 0.80, 0, 1030, 670, 190];

  function makeFish(spec, idx, isOrange, rnd) {
    var f = {
      idx: idx, orange: isOrange,
      x: spec[0], y: spec[1], a: spec[2] * Math.PI / 180,
      L: spec[3], z: spec[4], red: !!spec[5],
      hx: spec[6], hy: spec[7], hr: spec[8] * 0.85,
      w: 0, v: 0, ph: rnd() * TAU,
      p1: rnd() * TAU, p2: rnd() * TAU, p3: rnd() * TAU, p4: rnd() * TAU,
      f1: 0.09 + rnd() * 0.05, f2: 0.19 + rnd() * 0.09, f3: 0.037 + rnd() * 0.02,
      v0: (isOrange ? 30 : 24 + rnd() * 12) * (0.55 + 0.5 * spec[4]),
      orbR: 0, orbDir: 1,
      amp: 0.5, finL: 0, finR: 0, alpha: 1,
      cx: new Float32Array(NODES), cy: new Float32Array(NODES),   // chain (follow-the-leader)
      sx: new Float32Array(NODES), sy: new Float32Array(NODES),   // rendered spine (chain + swim wave)
      nx: new Float32Array(NODES), ny: new Float32Array(NODES),   // unit normals at nodes
      tailX: 0, tailY: 0, wakeX: 0, wakeY: 0, midX: 0, midY: 0
    };
    f.W = f.L * 0.069;                 // max half-width
    f.v = f.v0;
    var seg = f.L / (NODES - 1), ca = Math.cos(f.a), sa = Math.sin(f.a);
    var bend = (rnd() - 0.5) * 1.1, px = f.x, py = f.y;      // start on a gentle arc rather than ruler-straight
    f.cx[0] = px; f.cy[0] = py;
    for (var i = 1; i < NODES; i++) {
      var aa = f.a + bend * (i / (NODES - 1));
      px -= Math.cos(aa) * seg; py -= Math.sin(aa) * seg;
      f.cx[i] = px; f.cy[i] = py;
    }
    return f;
  }

  function School(opts) {
    opts = opts || {};
    this.mode = opts.mode || 'pond';
    var rnd = mulberry(opts.seed || 20260411);
    this.fish = [];
    var i;
    for (i = 0; i < LAYOUT.length; i++) this.fish.push(makeFish(LAYOUT[i], i, false, rnd));
    this.orange = makeFish(ORANGE, LAYOUT.length, true, rnd);
    this.fish.push(this.orange);
    if (this.mode === 'orbit') {
      var radii = [470, 400, 215, 300, 250, 350, 150, 190, 270, 520];
      for (i = 0; i < LAYOUT.length; i++) {
        var f = this.fish[i];
        f.orbR = radii[i];
        f.orbDir = (f.z < 0.4) ? -1 : 1;       // the deep, dim layer counter-rotates
        f.v0 *= 1.15;
      }
      this.orange.hx = 985; this.orange.hy = 600; this.orange.hr = 190;
      this.orange.v0 *= 0.8;
    }
    this.order = this.fish.slice().sort(function (a, b) { return a.z - b.z; });
    for (i = 0; i < this.fish.length; i++) this._pose(this.fish[i]);
  }

  School.prototype.step = function (dt, t) {
    var fish = this.fish, n = fish.length, o = this.orange, orbit = this.mode === 'orbit';
    for (var i = 0; i < n; i++) {
      var f = fish[i];
      var wander = 0.20 * (Math.sin(t * f.f1 + f.p1) + 0.7 * Math.sin(t * f.f2 + f.p2) + 0.5 * Math.sin(t * f.f3 + f.p3));
      var wt = wander, dx, dy, d, diff;

      if (orbit && !f.orange) {
        dx = f.x - o.x; dy = f.y - o.y; d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        var want = Math.atan2(dy, dx) + f.orbDir * (Math.PI / 2 + clamp((d - f.orbR) / f.orbR, -0.9, 0.9) * 1.0);
        wt = wander * 0.22 + 0.75 * clamp(wrapPi(want - f.a), -1, 1);
      } else {
        dx = f.hx - f.x; dy = f.hy - f.y; d = Math.sqrt(dx * dx + dy * dy);
        if (d > f.hr) {
          diff = wrapPi(Math.atan2(dy, dx) - f.a);
          wt += 0.55 * Math.min(1, (d - f.hr) / 220) * clamp(diff * 1.2, -1, 1);
        }
      }

      // neighbours: soft separation within a depth band, gentle alignment (pond only)
      var ax = 0, ay = 0, an = 0;
      for (var j = 0; j < n; j++) {
        if (j === i) continue;
        var g = fish[j];
        var ex = f.x - g.midX, ey = f.y - g.midY, e2 = ex * ex + ey * ey;
        var r = (f.L + g.L) * 0.33;
        if (e2 < r * r && Math.abs(f.z - g.z) < 0.45) {
          var e = Math.sqrt(e2) + 1e-3;
          wt += (orbit ? 0.38 : 0.5) * (1 - e / r) * clamp(wrapPi(Math.atan2(ey, ex) - f.a), -1, 1);
        }
        if (!orbit && !g.orange && e2 < 320 * 320) { ax += Math.cos(g.a); ay += Math.sin(g.a); an++; }
      }
      if (an && !f.orange) wt += 0.10 * Math.sin(Math.atan2(ay, ax) - f.a);

      var wmax = 0.05 + 1.3 * f.v / f.L;                   // keep turning radius proportionate to body length
      wt = clamp(wt, -wmax, wmax);
      f.w += (wt - f.w) * (1 - Math.exp(-dt * 1.4));
      f.a = wrapPi(f.a + f.w * dt);
      var vt = f.v0 * (0.78 + 0.22 * Math.sin(t * 0.13 + f.p4)) + Math.abs(f.w) * 14;
      f.v += (vt - f.v) * (1 - Math.exp(-dt * 0.8));
      f.x += Math.cos(f.a) * f.v * dt;
      f.y += Math.sin(f.a) * f.v * dt;
      f.ph = (f.ph + dt * TAU * (0.22 + 1.9 * f.v / f.L)) % (TAU * 4);
      f.amp = 0.6 + 0.4 * Math.sin(t * 0.21 + f.p2);

      // follow-the-leader chain
      var cx = f.cx, cy = f.cy, seg = f.L / (NODES - 1);
      cx[0] = f.x; cy[0] = f.y;
      for (var k = 1; k < NODES; k++) {
        var qx = cx[k] - cx[k - 1], qy = cy[k] - cy[k - 1];
        var ql = Math.sqrt(qx * qx + qy * qy) || 1;
        cx[k] = cx[k - 1] + qx / ql * seg; cy[k] = cy[k - 1] + qy / ql * seg;
      }
      this._pose(f);
    }
  };

  /* chain -> rendered spine with travelling swim wave; fin angles; fade */
  School.prototype._pose = function (f) {
    var cx = f.cx, cy = f.cy, sx = f.sx, sy = f.sy, nx = f.nx, ny = f.ny, i, tx, ty, l;
    var A = f.L * (0.052 + 0.034 * f.amp);
    for (i = 0; i < NODES; i++) {
      var a = i > 0 ? i - 1 : 0, b = i < NODES - 1 ? i + 1 : NODES - 1;
      tx = cx[b] - cx[a]; ty = cy[b] - cy[a]; l = Math.sqrt(tx * tx + ty * ty) || 1;
      var s = i / (NODES - 1);
      var off = A * (0.07 + 0.93 * Math.pow(s, 1.55)) * Math.sin(f.ph - 5.6 * s);
      sx[i] = cx[i] - ty / l * off; sy[i] = cy[i] + tx / l * off;
    }
    for (i = 0; i < NODES; i++) {
      var a2 = i > 0 ? i - 1 : 0, b2 = i < NODES - 1 ? i + 1 : NODES - 1;
      tx = sx[b2] - sx[a2]; ty = sy[b2] - sy[a2]; l = Math.sqrt(tx * tx + ty * ty) || 1;
      nx[i] = -ty / l; ny[i] = tx / l;
    }
    var m = (NODES * 0.4) | 0, tl = (NODES * 0.87) | 0;
    f.midX = sx[m]; f.midY = sy[m];
    f.tailX = sx[tl]; f.tailY = sy[tl];
    f.wakeX = cx[tl]; f.wakeY = cy[tl];                    // wake point without the swim wiggle
    var flap = Math.sin(f.ph * 0.5 + f.p1), flap2 = Math.sin(f.ph * 0.5 + f.p1 + 2.3);
    f.finL = 0.98 + 0.17 * flap - f.w * 0.8;
    f.finR = 0.74 + 0.17 * flap2 + f.w * 0.8;
    var dd = Math.sqrt((f.midX - POOL.x) * (f.midX - POOL.x) + (f.midY - POOL.y) * (f.midY - POOL.y));
    f.alpha = (0.15 + 0.71 * f.z) * (1 - 0.72 * smooth(380, 900, dd));
  };

  /* ---------- drawing ---------- */
  var _pt = [0, 0];
  function at(f, s, lat) {           // point at arclength fraction s, lateral offset lat (design px)
    var u = clamp(s, 0, 1) * (NODES - 1), i = Math.min(NODES - 2, u | 0), k = u - i;
    var nxx = f.nx[i] + (f.nx[i + 1] - f.nx[i]) * k, nyy = f.ny[i] + (f.ny[i + 1] - f.ny[i]) * k;
    _pt[0] = f.sx[i] + (f.sx[i + 1] - f.sx[i]) * k + nxx * lat;
    _pt[1] = f.sy[i] + (f.sy[i + 1] - f.sy[i]) * k + nyy * lat;
    return _pt;
  }
  var _buf = new Float32Array(256);
  function smoothClosed(ctx, n) {    // closed quadratic-midpoint curve through _buf[0..2n)
    var lx = _buf[2 * n - 2], ly = _buf[2 * n - 1];
    ctx.moveTo((lx + _buf[0]) / 2, (ly + _buf[1]) / 2);
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      ctx.quadraticCurveTo(_buf[2 * i], _buf[2 * i + 1], (_buf[2 * i] + _buf[2 * j]) / 2, (_buf[2 * i + 1] + _buf[2 * j + 1]) / 2);
    }
    ctx.closePath();
  }

  var PAL = {
    pale: {
      fin: 'rgba(150,160,186,0.34)', finEdge: 'rgba(205,212,230,0.38)', vein: 'rgba(215,222,240,0.22)',
      tail: 'rgba(122,130,154,0.50)', dorsal: 'rgba(34,36,46,0.88)', shade: 'rgba(72,78,100,0.20)',
      red: 'rgba(232,96,52,0.85)'
    },
    orange: {
      fin: 'rgba(118,106,52,0.86)', finEdge: 'rgba(214,34,14,0.95)', vein: 'rgba(170,150,70,0.5)',
      tail: 'rgba(104,94,48,0.9)', dorsal: 'rgba(20,10,4,0.95)', shade: 'rgba(190,70,0,0.42)',
      red: 'rgba(214,34,14,0.95)'
    }
  };

  /* pectoral fin outline in fin-local units: x along the fin axis, y<0 = leading (front) edge */
  var FIN = [
    [0, 0], [0, 0], [0.30, -0.075], [0.62, -0.165], [0.88, -0.205], [1.0, -0.12], [1.0, 0.06],
    [0.90, 0.21], [0.72, 0.275], [0.50, 0.26], [0.28, 0.17], [0.10, 0.07]
  ];
  function drawFin(ctx, f, side, ang, pal) {
    var W = f.W, len = f.L * 0.205;
    var p = at(f, 0.175, side * W * 0.42), bx = p[0], by = p[1];
    var u = 0.175 * (NODES - 1), i = u | 0;
    var tx = f.sx[i + 1] - f.sx[i], ty = f.sy[i + 1] - f.sy[i];
    var aa = Math.atan2(ty, tx) + side * ang;               // fin axis: tailward, rotated outward
    var ca = Math.cos(aa) * len, sa = Math.sin(aa) * len, n = 0, k;
    for (k = 0; k < FIN.length; k++) {
      var fx = FIN[k][0], fy = FIN[k][1] * -side;
      _buf[n++] = bx + ca * fx - sa * fy; _buf[n++] = by + sa * fx + ca * fy;
    }
    ctx.beginPath(); smoothClosed(ctx, n / 2);
    ctx.fillStyle = pal.fin; ctx.fill();
    ctx.lineWidth = f.orange ? 1.4 : 0.8; ctx.strokeStyle = pal.finEdge; ctx.stroke();
    // veins fan from the root to the outer edge
    ctx.beginPath();
    for (k = 0; k < 9; k++) {
      var v = k / 8, i0 = 3 + v * 6.2, ia = i0 | 0, kk = i0 - ia;
      var ex = _buf[2 * ia] + (_buf[2 * ia + 2] - _buf[2 * ia]) * kk, ey = _buf[2 * ia + 1] + (_buf[2 * ia + 3] - _buf[2 * ia + 1]) * kk;
      var c = (v - 0.45) * 0.16 * -side;
      var mx = (bx + ex) / 2 - (ey - by) * c, my = (by + ey) / 2 + (ex - bx) * c;
      ctx.moveTo(bx + (ex - bx) * 0.22, by + (ey - by) * 0.22);
      ctx.quadraticCurveTo(mx, my, bx + (ex - bx) * 0.93, by + (ey - by) * 0.93);
    }
    ctx.lineWidth = 0.6; ctx.strokeStyle = pal.vein; ctx.stroke();
    if (f.red || f.orange) {          // red leading edge
      ctx.beginPath();
      ctx.moveTo(_buf[4], _buf[5]);
      ctx.quadraticCurveTo(_buf[6], _buf[7], _buf[8], _buf[9]);
      ctx.quadraticCurveTo(_buf[10], _buf[11], (_buf[10] + _buf[12]) / 2, (_buf[11] + _buf[13]) / 2);
      ctx.lineWidth = f.orange ? 1.8 : 1.4; ctx.strokeStyle = pal.red; ctx.stroke();
    }
  }

  function drawFish(ctx, f, light, glow) {
    var pal = f.orange ? PAL.orange : PAL.pale, W = f.W, i, n, p, g;
    ctx.globalAlpha = f.alpha;

    // pectoral fins
    drawFin(ctx, f, 1, f.finL, pal);
    drawFin(ctx, f, -1, f.finR, pal);

    // tail fin
    n = 0;
    for (i = 0; i < TAIL.length; i++) { p = at(f, TAIL[i][0], TAIL[i][1] * W * 1.3); _buf[n++] = p[0]; _buf[n++] = p[1]; }
    ctx.beginPath(); smoothClosed(ctx, n / 2);
    ctx.fillStyle = pal.tail; ctx.fill();
    if (f.orange || f.red) {
      ctx.beginPath();
      ctx.moveTo(_buf[22], _buf[23]);
      for (i = 12; i < TAIL.length; i++) ctx.lineTo(_buf[2 * i], _buf[2 * i + 1]);
      ctx.lineWidth = 1.6; ctx.strokeStyle = pal.red; ctx.globalAlpha = f.alpha * (f.orange ? 1 : 0.6); ctx.stroke();
      ctx.globalAlpha = f.alpha;
    }

    // body outline
    var np = PROF.length; n = 0;
    for (i = 0; i < np; i++) { p = at(f, PROF[i][0], PROF[i][1] * W); _buf[n++] = p[0]; _buf[n++] = p[1]; }
    for (i = np - 1; i > 0; i--) { p = at(f, PROF[i][0], -PROF[i][1] * W); _buf[n++] = p[0]; _buf[n++] = p[1]; }
    var body = new Path2D(); smoothClosed(body, n / 2);

    var hx = f.sx[0], hy = f.sy[0];
    p = at(f, 0.84, 0); var ex = p[0], ey = p[1];
    g = ctx.createLinearGradient(hx, hy, ex, ey);
    if (f.orange) {
      g.addColorStop(0, '#ffb428'); g.addColorStop(0.2, '#ffc02e'); g.addColorStop(0.55, '#f58a12');
      g.addColorStop(0.8, '#e2460c'); g.addColorStop(1, '#c41c0c');
    } else {
      g.addColorStop(0, '#d4d7df'); g.addColorStop(0.22, '#e6e8ee'); g.addColorStop(0.62, '#cbced8');
      g.addColorStop(0.84, f.red ? '#d6aaa0' : '#b1b4c2'); g.addColorStop(1, f.red ? '#dc7a5c' : '#9a9db0');
    }
    ctx.fillStyle = g; ctx.fill(body);

    // soft highlight behind the head
    p = at(f, 0.15, W * 0.15);
    g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], W * 2.1);
    if (f.orange) { g.addColorStop(0, 'rgba(255,240,130,1)'); g.addColorStop(1, 'rgba(255,200,60,0)'); }
    else { g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
    ctx.fillStyle = g; ctx.fill(body);

    // warm spill from the orange koi onto pale fish
    if (light && !f.orange) {
      g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.r);
      g.addColorStop(0, 'rgba(255,150,70,' + (0.40 * glow).toFixed(3) + ')');
      g.addColorStop(0.45, 'rgba(255,140,70,' + (0.16 * glow).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,130,60,0)');
      ctx.fillStyle = g; ctx.fill(body);
    }

    // shaded flank beside the dorsal line
    var S0 = 0.25, S1 = 0.74, M = 12, s, w;
    ctx.beginPath();
    for (i = 0; i <= M; i++) { s = S0 + (S1 - S0) * i / M; p = at(f, s, 0); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    for (i = M; i >= 0; i--) {
      s = S0 + (S1 - S0) * i / M; w = Math.sin(Math.PI * i / M);
      p = at(f, s, -W * 0.50 * w * (1 - 0.75 * (i / M))); ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath(); ctx.fillStyle = pal.shade; ctx.fill();

    // dorsal line (tapered)
    var th = Math.max(0.9, f.L * 0.0052);
    ctx.beginPath();
    for (i = 0; i <= M; i++) { s = S0 + (S1 - S0) * i / M; p = at(f, s, th * Math.sin(Math.PI * Math.pow(i / M, 0.6))); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    for (i = M; i >= 0; i--) { s = S0 + (S1 - S0) * i / M; p = at(f, s, -th * Math.sin(Math.PI * Math.pow(i / M, 0.6))); ctx.lineTo(p[0], p[1]); }
    ctx.closePath(); ctx.fillStyle = pal.dorsal; ctx.fill();

    if (f.orange) { ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(206,40,10,0.75)'; ctx.stroke(body); }
    ctx.globalAlpha = 1;
  }

  /* draw the whole school. glow: 0..1 multiplier for the orange koi's light. */
  School.prototype.draw = function (ctx, glow) {
    var o = this.orange, i, g;
    if (glow === undefined) glow = 1;
    var light = { x: o.midX, y: o.midY, r: 360 };
    // halo under everything
    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createRadialGradient(o.midX, o.midY, 0, o.midX, o.midY, 430);
    g.addColorStop(0, 'rgba(255,150,50,' + (0.085 * glow).toFixed(3) + ')');
    g.addColorStop(0.35, 'rgba(255,120,40,' + (0.035 * glow).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = g; ctx.fillRect(o.midX - 430, o.midY - 430, 860, 860);
    ctx.globalCompositeOperation = 'source-over';

    for (i = 0; i < this.order.length; i++) {
      var f = this.order[i];
      if (f.orange) {
        ctx.globalCompositeOperation = 'lighter';
        g = ctx.createRadialGradient(o.midX, o.midY, 0, o.midX, o.midY, 150);
        g.addColorStop(0, 'rgba(255,170,70,' + (0.36 * glow).toFixed(3) + ')');
        g.addColorStop(0.5, 'rgba(255,140,50,' + (0.10 * glow).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g; ctx.fillRect(o.midX - 150, o.midY - 150, 300, 300);
        ctx.globalCompositeOperation = 'source-over';
      }
      drawFish(ctx, f, light, glow);
    }
  };

  global.Koi = { School: School, POOL: POOL, NODES: NODES };
})(window);
