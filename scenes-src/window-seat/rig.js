// A small cat made of capsules, drawn as hard art pixels. No dependencies.
//   Rig.timeline(keys)      -> { at(t) -> pose or null, T (seconds) }
//   Rig.draw(pose, lagged, buf, W, H)   rasterises into buf (Uint8: 0 none, 1 body, 2 inner line, 3 far legs)
// A pose is in "forward" coordinates: x towards the nose, y up, origin at the root (a point on the ground);
// the root is at (x, y) in art pixels (y down) and face (-1 left .. +1 right) mirrors the cat.
(function () {
  const lerp = (a, b, u) => a + (b - a) * u;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const BASE = {
    vis: 1, x: 0, y: 0, face: -1,
    hip: [-16, 29], sh: [16, 28], rh: 12, rs: 11, sag: 0,
    head: [12, 11], turn: 0, ear: 0,
    fn: [18, 0], ff: [15, 0], bn: [-17, 0], bf: [-13, 0],     // paws: front near/far, back near/far
    tail: [-35, 40, 30], sway: 0.3, flick: 0,
    walk: 0, ph: 0, flat: 0,
  };
  function mix(p, q, u) {
    const o = {};
    for (const k in p) {
      const a = p[k], b = q[k];
      o[k] = Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], u)) : lerp(a, b, u);
    }
    return o;
  }
  const EASE = {
    lin: u => u,
    io: u => u * u * (3 - 2 * u),
    in: u => u * u,
    out: u => 1 - (1 - u) * (1 - u),
    snap: u => 1 - Math.pow(1 - u, 3),
    hold: u => (u < 1 ? 0 : 1),
  };
  // keys: [seconds since the previous key, pose changes (kept from then on), {e: ease, arc: jump height}]
  function timeline(keys, start) {
    let t = start || 0, cur = Object.assign({}, BASE);
    const K = [];
    for (const [dt, ch, opt] of keys) {
      t += dt;
      cur = Object.assign({}, cur, ch || {});
      K.push({ t, p: cur, o: opt || {} });
    }
    function at(tt) {
      if (tt < K[0].t || tt >= K[K.length - 1].t) return null;
      let i = 0;
      while (K[i + 1].t <= tt) i++;
      const a = K[i], b = K[i + 1], u = (tt - a.t) / (b.t - a.t);
      const p = mix(a.p, b.p, EASE[b.o.e || 'io'](u));
      if (b.o.arc !== undefined) {               // a jump: the root flies a parabola at constant x speed
        p.x = lerp(a.p.x, b.p.x, u);
        p.y = lerp(a.p.y, b.p.y, u) - 4 * b.o.arc * u * (1 - u);
      }
      if (b.o.lin) { p.x = lerp(a.p.x, b.p.x, u); p.ph = lerp(a.p.ph, b.p.ph, u); }
      return p;
    }
    return { at, T: t, keys: K };
  }

  // two-bone IK: the middle joint, bending to the side given by sign
  function ik(J, T, l1, l2, sign) {
    let dx = T[0] - J[0], dy = T[1] - J[1], d = Math.hypot(dx, dy);
    const m = l1 + l2 - 0.01;
    if (d > m) { dx *= m / d; dy *= m / d; d = m; }
    if (d < Math.abs(l1 - l2) + 0.01) d = Math.abs(l1 - l2) + 0.01;
    const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const b = Math.atan2(dy, dx) + sign * a;
    return [J[0] + l1 * Math.cos(b), J[1] + l1 * Math.sin(b)];
  }
  // walk cycle, four beats in a cat's order: near hind, near fore, far hind, far fore. ph counts cycles; the
  // body moves CYCLE art pixels per cycle and a paw on the ground stays exactly where it was put down.
  const CYCLE = 26, STANCE = 0.68, frac = v => v - Math.floor(v);
  function paw(rest, ph, off, lift) {
    const u = frac(ph + off);
    if (u < STANCE) return [rest + CYCLE * (STANCE / 2 - u), 0, Math.sin(Math.PI * u / STANCE)];
    const v = (u - STANCE) / (1 - STANCE), s = v * v * (3 - 2 * v);
    return [rest + CYCLE * STANCE * (s - 0.5), lift * Math.pow(Math.sin(Math.PI * v), 0.8), 0];
  }
  function walkPose(ph) {
    const bn = paw(-15, ph, 0, 4), fn = paw(16, ph, 0.25, 5), bf = paw(-12, ph, 0.5, 4), ff = paw(13, ph, 0.75, 5);
    // the leg that carries the weight pushes its blade up: shoulders and hips roll, the head stays level
    const sh = 1.5 * Math.max(fn[2], ff[2]) - 1.0, hip = 1.2 * Math.max(bn[2], bf[2]) - 0.8;
    return { bn, fn, bf, ff, sh, hip, head: -sh, blade: fn[2], haunch: bn[2] };
  }

  // pose -> shapes in art pixels
  function shapes(p, lag, time) {
    const S = { far: [], body: [], lines: [] };
    const X = v => p.x + p.face * v[0], Y = v => p.y - v[1];
    const cap = (L, a, b, ra, rb) => L.push([X(a), Y(a), X(b), Y(b), ra, rb]);
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
    let hip = p.hip.slice(), sh = p.sh.slice(), head = p.head.slice();
    let fn = p.fn, ff = p.ff, bn = p.bn, bf = p.bf, blade = 0;
    if (p.walk > 0.001) {
      const w = walkPose(p.ph), k = p.walk, m2 = (a, b) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
      fn = m2(fn, w.fn); ff = m2(ff, w.ff); bn = m2(bn, w.bn); bf = m2(bf, w.bf);
      hip[1] += k * w.hip; sh[1] += k * w.sh; head[1] += k * w.head;
      blade = k * w.blade;
    }
    const hd = add(sh, head);
    // legs
    const fore = (L, off, F) => {
      const J = add(sh, [1 + off, -2.5]), A = add(F, [-0.5, 2.6]);
      const E = ik(J, A, 12.8, 12.8, -1);
      E[1] = Math.max(E[1], F[1] + 3.2);                                  // an elbow never goes through the floor
      cap(L, J, E, 5.2, 3.1); cap(L, E, A, 3.1, 2.6); cap(L, add(F, [-0.5, 2.3]), add(F, [2.6, 2.1]), 2.4, 2.1);
    };
    const hind = (L, off, F, line) => {
      const J = add(hip, [1 + off, -3]);
      const s = clamp((J[1] - F[1] - 9) / 11, 0, 1) * (1 - p.flat);
      const K = add(F, [lerp(-7.5, -3.5, s), lerp(2.4, 7.5, s)]);          // the hock
      const N = ik(J, K, 11.8, 11.8, 1);
      if (F[1] >= 0) N[1] = Math.max(N[1], F[1] + 4);
      cap(L, J, N, 8.2, 4.3); cap(L, N, K, 4.0, 2.7); cap(L, K, add(F, [0, 2.4]), 2.7, 2.4);
      cap(L, add(F, [0, 2.3]), add(F, [3, 2.1]), 2.4, 2.1);
      if (line) {                                                           // the haunch, drawn like the picture's cat
        const dx = N[0] - J[0], dy = N[1] - J[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
        const a = [J[0] + nx * 6.2 + 2, J[1] + ny * 6.2 + 4], b = [N[0] + nx * 2.6 + 1, N[1] + ny * 2.6];
        S.lines.push([X(a), Y(a), X(b), Y(b)]);
        const c = [lerp(N[0], K[0], 0.7) + 2.2, lerp(N[1], K[1], 0.7)];
        S.lines.push([X(b), Y(b), X(c), Y(c)]);
      }
    };
    fore(S.far, 2, ff); hind(S.far, 2.5, bf, false);
    // torso
    const rm = 0.5 * (p.rh + p.rs) * 0.96;
    const mid = [0.5 * (hip[0] + sh[0]), 0.5 * (hip[1] + sh[1]) - p.sag];
    cap(S.body, hip, mid, p.rh, rm); cap(S.body, mid, sh, rm, p.rs);
    if (p.flat > 0.3) cap(S.body, [bn[0], 4.5], [fn[0] - 5, 4.5], 4.5 * p.flat, 4.5 * p.flat);   // lying: belly on the sill
    if (blade > 0) S.body.push({ e: [X(add(sh, [-1, p.rs - 3 + 2.4 * blade])), Y(add(sh, [-1, p.rs - 3 + 2.4 * blade])), 5.5, 3] });
    // tail: each link takes its bend from a slightly earlier pose, so it follows through
    let q = add(hip, [-p.rh + 3.5, 2.5]);
    const n = 10, seg = 4.3;
    for (let i = 0; i < n; i++) {
      const lp = lag ? (lag(i) || p) : p, s = i / (n - 1);
      let a = lp.tail[0] + lp.tail[1] * s + lp.tail[2] * s * s;
      a += lp.sway * (4 + 12 * s) * Math.sin(2 * Math.PI * (time * 0.5 - s * 0.6));
      a += lp.flick * 70 * s * s;
      a *= Math.PI / 180;
      const e = [q[0] - seg * Math.cos(a), q[1] + seg * Math.sin(a)];
      if (p.flat > 0) e[1] = Math.max(e[1], lerp(-99, 3, p.flat));        // lying: the tail rests on the sill
      cap(S.body, q, e, lerp(3.5, 2.8, s), lerp(3.5, 2.8, (i + 1) / (n - 1)));
      q = e;
    }
    fore(S.body, 0, fn); hind(S.body, 0, bn, true);
    // neck and head
    // (seen from behind, turn = 1, the head is as wide as ever however the body is turned)
    const t = p.turn, t1 = 1 - t, fh = lerp(p.face, p.face < 0 ? -1 : 1, t);
    const HX = v => X(hd) + fh * (v[0] - hd[0]);
    cap(S.body, add(sh, [2, 3]), add(hd, [-1 * t1, -2]), 8, 7);
    S.body.push({ e: [X(hd), Y(hd), lerp(9.4, 10.6, t), lerp(8.2, 8.4, t)] });
    if (t1 > 0.15) S.body.push({ e: [HX(add(hd, [5.6 * t1, -2.8])), Y(add(hd, [5.6 * t1, -2.8])), 3.9 * t1 + 1, 3.8] });
    const eo = [-3.5 * p.ear * t1, -2.5 * p.ear];
    const tri = (a, b, c) => S.body.push({ t: [HX(a), Y(a), HX(b), Y(b), HX(c), Y(c)] });
    const m = (a, b) => add(hd, [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    tri(m([-8, 3], [-10.6, 2]), add(m([-5.5, 12.6], [-9, 12.8]), eo), m([0.5, 7], [-2.5, 7.5]));
    tri(m([-3, 6.5], [2.5, 7.5]), add(m([1, 13.6], [9, 12.8]), eo), m([6.5, 5], [10.6, 2]));
    return S;
  }

  function draw(p, buf, W, H, lag, time) {
    const S = shapes(p, lag, time || 0);
    const paint = (list, val, only) => {
      for (const s of list) {
        if (s.e) {
          const [cx, cy, rx, ry] = s.e;
          for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++)
            for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
              const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
              if (dx * dx + dy * dy <= 1) buf[y * W + x] = val;
            }
        } else if (s.t) {
          const [ax, ay, bx, by, cx, cy] = s.t;
          const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
          const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
          const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), sg = area < 0 ? -1 : 1;
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const px = x + 0.5, py = y + 0.5;
            const e1 = sg * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
            const e2 = sg * ((cx - bx) * (py - by) - (cy - by) * (px - bx));
            const e3 = sg * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx));
            if (e1 >= -0.35 && e2 >= -0.35 && e3 >= -0.35) buf[y * W + x] = val;
          }
        } else {
          const [ax, ay, bx, by, ra, rb] = s.length === 4 ? [s[0], s[1], s[2], s[3], 0.62, 0.62] : s;
          const r = Math.max(ra, rb), dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
          const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
          const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const px = x + 0.5 - ax, py = y + 0.5 - ay;
            const h = clamp((px * dx + py * dy) / l2, 0, 1);
            const ex = px - dx * h, ey = py - dy * h, rr = ra + (rb - ra) * h;
            if (ex * ex + ey * ey <= rr * rr && (!only || buf[y * W + x] === only)) buf[y * W + x] = val;
          }
        }
      }
    };
    paint(S.far, 3); paint(S.body, 1); paint(S.lines, 2, 1);
    // nothing of the cat below the ground it stands on, when it lies flat
    return S;
  }

  // the poses the timeline is built from (changes on top of BASE). The cat keeps one size: the body radii never
  // change and hip to shoulder stays between 29 and 35.
  const P = {
    stand:  { hip: [-16, 29], sh: [16, 28], sag: 0, head: [12, 11], turn: 0, ear: 0, flat: 0,
              fn: [18, 0], ff: [15, 0], bn: [-17, 0], bf: [-13, 0], tail: [-35, 40, 30], sway: 0.3, walk: 0 },
    walk:   { hip: [-16, 29], sh: [16, 27.5], head: [14, 7], tail: [12, -18, 34], sway: 0.35, walk: 1, ear: 0 },
    crouch: { hip: [-14, 16], sh: [15, 17], sag: -1, head: [12, 12], fn: [19, 0], ff: [16, 0], bn: [-12, 0], bf: [-9, 0],
              tail: [-15, -20, 20], ear: 0.4, sway: 0.1 },
    launch: { hip: [-13, 24], sh: [15, 36], sag: 0, head: [9, 12], fn: [27, 30], ff: [24, 27], bn: [-22, 0], bf: [-19, 0],
              tail: [-50, 10, 10], ear: 0.8 },
    fly:    { hip: [-15, 17], sh: [14, 32], head: [10, 11], fn: [30, 33], ff: [27, 29], bn: [-29, 3], bf: [-26, 7],
              tail: [-30, -10, -10], ear: 1, sway: 0 },
    mantle: { hip: [-15, 9], sh: [13, 24], head: [12, 10], fn: [20, 0], ff: [17, 0], bn: [-21, -12], bf: [-18, -9],
              tail: [-60, 20, 0], ear: 0.7 },
    reach:  { hip: [-15, 32], sh: [14, 20], head: [12, 10], fn: [23, 0], ff: [20, 2], bn: [-20, 14], bf: [-17, 17],
              tail: [35, 15, 0], ear: 0.6 },
    squash: { hip: [-14, 19], sh: [15, 17], sag: -1, head: [13, 8], fn: [20, 0], ff: [17, 0], bn: [-12, 0], bf: [-9, 0],
              tail: [15, 20, 20], ear: 0.3 },
    haunch: { hip: [-16, 13.5], sh: [14, 27], head: [10, 11], fn: [18, 0], ff: [15, 0], bn: [-7, 0], bf: [-4, 0],
              tail: [-75, 90, -10], sway: 0.1, flat: 1 },
    lie:    { hip: [-15, 13.5], sh: [17, 20], sag: 2.5, head: [1, 14.5], turn: 1, fn: [31, 0], ff: [28, 0],
              bn: [-5, 0], bf: [-2, 0], tail: [-80, 95, -12], sway: 0, flat: 1 },
    bow:    { hip: [-17, 30], sh: [11, 10.5], sag: 2.5, head: [13, 4], fn: [35, 0], ff: [32, 0], bn: [-19, 0], bf: [-15, 0],
              tail: [55, 25, 25], sway: 0.15, ear: 0.3, turn: 0, flat: 0 },
    lunge:  { hip: [-8, 24], sh: [24, 27], sag: 1.5, head: [11, 12], fn: [26, 0], ff: [23, 0], bn: [-25, 0], bf: [-33, 5],
              tail: [25, 10, 30], ear: 0 },
    peer:   { hip: [-15, 23], sh: [15, 13], head: [13, 0], fn: [20, 0], ff: [17, 0], bn: [-14, 0], bf: [-10, 0],
              tail: [20, 20, 20], ear: 0.2, sway: 0.2 },
    dive:   { hip: [-17, 27], sh: [10, 11], sag: 0, head: [11, 1], fn: [24, -12], ff: [21, -9], bn: [-28, 22], bf: [-25, 26],
              tail: [50, -10, 0], ear: 0.8, sway: 0 },
  };
  window.Rig = { BASE, P, mix, timeline, draw, CYCLE };
})();
