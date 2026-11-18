// The butterfly: where it is and how it holds itself at every moment of the loop, and its shape as triangles.
//
// Fly.build(route) flies the whole loop once at 240 steps a second (so headings, banking and the wing beat can be
// worked out step by step) and keeps the result in tables; Fly.at(t) reads them. route = { inbound, outbound,
// glides, fadeOut }: way points [seconds, x, y, size] in picture pixels (size 1 = as painted, smaller = further
// away), the last inbound one and the first outbound one being the finger.
//
// The butterfly's own frame: F forward, U up, R to its right; on the screen x right, y up, z to the viewer.
// A wing is a flat sheet (wing.png) hinged along the body: sheet point (u, v) sits at F*u + (U*sin(phi) +- R*cos(phi))*v,
// phi being how far the wings are raised. On the finger it stands exactly as painted: heading 30 degrees towards
// the viewer, rolled 11.5 away, wings at 63.5.
(function () {
  const { L, T, s3, s5, ramp, clamp, lerp } = Story;
  const TAU = Math.PI * 2, RAD = Math.PI / 180;
  const HZ = 240, N = L * HZ;
  const ROOT = [1163, 407];                       // the wing root when it stands on the finger
  const PSI0 = 30 * RAD, ROLL0 = -11.5 * RAD, PHI0 = 63.5 * RAD;
  const KZ = 620;                                 // how much coming nearer counts as speed, for the heading
  const SHEET = [-138, -8, 62, 128];              // wing.png in sheet units: u0, v0, u1, v1

  // one beat of the wings, 1 = up, -1 = down: the way down takes 42 % of it
  const stroke = ph => { ph -= Math.floor(ph); return ph < 0.42 ? Math.cos(Math.PI * ph / 0.42) : -Math.cos(Math.PI * (ph - 0.42) / 0.58); };

  // way points -> position at time t (Catmull-Rom in x, y and log size); null outside
  function path(pts, endsAtRest) {
    const P = pts.map(p => [p[0], p[1], p[2], Math.log(p[3])]);
    const n = P.length, M = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)], c = P[i];
      const m = [0, 0, 0];
      if (i > 0 && i < n - 1) {
        const d0 = c[0] - a[0], d1 = b[0] - c[0];
        for (let k = 0; k < 3; k++) m[k] = ((c[k + 1] - a[k + 1]) / d0 * d1 + (b[k + 1] - c[k + 1]) / d1 * d0) / (d0 + d1);
      } else if (!(endsAtRest & (i === 0 ? 1 : 2))) {
        for (let k = 0; k < 3; k++) m[k] = (b[k + 1] - a[k + 1]) / (b[0] - a[0]);
      }
      M.push(m);
    }
    return t => {
      if (t < P[0][0] || t > P[n - 1][0]) return null;
      let i = 0; while (i < n - 2 && P[i + 1][0] <= t) i++;
      const a = P[i], b = P[i + 1], h = b[0] - a[0], u = (t - a[0]) / h;
      const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const o = [0, 0, 0];
      for (let k = 0; k < 3; k++) o[k] = h00 * a[k + 1] + h10 * h * M[i][k] + h01 * b[k + 1] + h11 * h * M[i + 1][k];
      return [o[0], o[1], Math.exp(o[2])];
    };
  }
  // smooth curve through [seconds, value] keys
  function keys(K) {
    return t => {
      if (t <= K[0][0]) return K[0][1];
      for (let i = 1; i < K.length; i++) if (t < K[i][0]) return lerp(K[i - 1][1], K[i][1], s3((t - K[i - 1][0]) / (K[i][0] - K[i - 1][0])));
      return K[K.length - 1][1];
    };
  }

  function build(route) {
    const tin = path(route.inbound, 2), tout = path(route.outbound, 1);
    const glide = t => { let g = 0; for (const [a, b] of route.glides) g = Math.max(g, s3(ramp(t, a - 0.12, a + 0.1)) * (1 - s3(ramp(t, b - 0.1, b + 0.14)))); return g; };
    // the wings while it stands on the finger: settling, at rest as painted, a slow flex now and then, and
    // opening wide before it leaves
    const rest = keys([
      [T.land, 70], [T.land + 0.22, 82], [T.land + 0.7, 36], [T.land + 1.2, 78], [T.land + 1.75, 50], [T.land + 2.4, 63.5],
      [T.land + 3.3, 63.5], [T.land + 4.1, 26], [T.land + 4.35, 26], [T.land + 5.2, 63.5],
      [T.stare + 0.9, 63.5], [T.stare + 1.7, 32], [T.stare + 2.0, 32], [T.stare + 2.9, 63.5],
      [T.open, 63.5], [T.open + 0.34, 16], [T.off - 0.13, 14], [T.off, 80]]);
    const base = t => (t >= T.enter && t < T.land) ? tin(t) : (t >= T.land && t < T.off) ? [ROOT[0], ROOT[1], 1] : (t >= T.off && t <= T.gone) ? tout(t) : null;

    const tab = {};
    for (const k of ['x', 'y', 's', 'psi', 'pitch', 'bank', 'phi', 'dphi', 'legs', 'alpha', 'perch', 'lookYaw', 'lookPitch']) tab[k] = new Float32Array(N + 1);
    let psi = PSI0, dpsi = 0, phase = 0, live = false, prevPhi = PHI0, lookY = 0, lookP = 0, dLookY = 0, dLookP = 0;
    const dt = 1 / HZ;
    for (let i = 0; i <= N; i++) {
      const t = i / HZ, p = base(t);
      if (!p) { live = false; lookY += (0 - lookY) * 0.02; lookP += (0 - lookP) * 0.02; tab.lookYaw[i] = lookY; tab.lookPitch[i] = lookP; continue; }
      const p0 = base(Math.max(t - 0.09, T.enter)) || p, p1 = base(Math.min(t + 0.09, T.gone)) || p;
      const h = 0.18, vx = (p1[0] - p0[0]) / h / p[2], vy = (p1[1] - p0[1]) / h / p[2], vz = KZ * Math.log(p1[2] / p0[2]) / h;
      const onFinger = t >= T.land && t < T.off;
      const landing = onFinger ? 1 : t < T.land ? s5(ramp(t, T.hover - 0.25, T.land - 0.1)) : 1 - s5(ramp(t, T.off, T.off + 0.55));
      const hov = t < T.land ? s3(ramp(t, T.hover - 0.7, T.hover + 0.1)) : 1 - s3(ramp(t, T.off + 0.2, T.off + 1.0));

      // heading: follows the way it flies, turning like something with a little weight
      const sp = Math.hypot(vx, vz);
      let want = sp > 12 ? Math.atan2(vz, vx) : psi;
      if (!live) { psi = want; dpsi = 0; phase = 0.1; live = true; }
      while (want - psi > Math.PI) want -= TAU;
      while (want - psi < -Math.PI) want += TAU;
      if (onFinger) { psi = PSI0; dpsi = 0; }
      else { const w = 7.5; dpsi += (w * w * (want - psi) - 2 * w * dpsi) * dt; psi += dpsi * dt; }
      let a = psi - PSI0; a -= TAU * Math.round(a / TAU);
      tab.psi[i] = PSI0 + a * (1 - landing);

      // wing beat
      const g = glide(t), climb = clamp(-vy / 140, -0.5, 1);
      const freq = lerp(lerp(5.0 + 1.1 * Math.max(climb, 0), 6.2, hov), 1.4, g) + 0.3 * Math.sin(t * 2.3);
      if (t >= T.off && t - dt < T.off) phase = 0;                       // it leaves on a down beat
      phase += freq * dt;
      const amp = lerp(1, 0.72, hov * (1 - g));
      const flying = lerp(24 + 54 * amp * stroke(phase), 30 + 7 * stroke(phase), g);
      const tremble = 1.1 * Math.sin(TAU * t * 0.63) + 0.5 * Math.sin(TAU * t * 1.7 + 1);
      const settle = t < T.land ? s3(ramp(t, T.land - 0.16, T.land)) : 1;
      const phi = onFinger ? rest(t) + tremble * s3(ramp(t, T.land + 2, T.land + 3)) * (1 - s3(ramp(t, T.open - 0.3, T.open)))
        : lerp(flying, 70, t < T.land ? settle : 0);
      tab.phi[i] = phi * RAD;
      tab.dphi[i] = live && i > 0 ? (phi * RAD - prevPhi) / dt : 0;
      prevPhi = phi * RAD;

      // body
      const flare = t < T.land ? 20 * Math.sin(Math.PI * ramp(t, T.hover - 0.5, T.land)) : 13 * Math.sin(Math.PI * ramp(t, T.off - 0.05, T.off + 0.9));
      tab.pitch[i] = (16 + 14 * climb + 5 * Math.sin(TAU * (phase - 0.12)) + flare) * (1 - landing) * RAD;
      tab.bank[i] = lerp(clamp(0.11 * dpsi, -0.6, 0.6), ROLL0, landing);

      // where: the path, and on it the bob of every beat and a restless wander
      const loose = (1 - landing) * (1 - 0.45 * g);
      const bob = -3.4 * amp * Math.cos(TAU * (phase - 0.3));
      const wx = 8 * Math.sin(TAU * t * 0.83 + 1.3) + 5 * Math.sin(TAU * t * 1.37 + 0.4) + 2.5 * Math.sin(TAU * t * 2.9);
      const wy = 6 * Math.sin(TAU * t * 0.61 + 2.1) + 4 * Math.sin(TAU * t * 1.9) + bob;
      tab.x[i] = p[0] + wx * loose * p[2];
      tab.y[i] = p[1] + wy * loose * p[2];
      tab.s[i] = p[2];
      tab.legs[i] = t < T.off ? s3(ramp(t, T.hover - 0.1, T.land - 0.12)) : 1 - s3(ramp(t, T.off + 0.05, T.off + 0.5));
      tab.perch[i] = onFinger ? s3(ramp(t, T.land, T.land + 0.25)) * (1 - s3(ramp(t, T.off - 0.08, T.off))) : 0;
      tab.alpha[i] = s3(ramp(t, T.enter, T.enter + 1.4)) * (route.fadeOut ? 1 - s3(ramp(t, T.gone - route.fadeOut, T.gone - 0.1)) : 1);

      // what it does to her: her eyes follow it down
      const att = s3(ramp(t, T.enter + 2.0, T.enter + 3.3)) * (1 - s3(ramp(t, T.land - 0.5, T.land + 1.0)));
      const ty = clamp((tab.x[i] - ROOT[0]) / 26, -4, 8) * att, tp = clamp((ROOT[1] - tab.y[i]) / 24, -1.5, 7) * att;
      const w = 4.2;
      dLookY += (w * w * (ty - lookY) - 2 * w * dLookY) * dt; lookY += dLookY * dt;
      dLookP += (w * w * (tp - lookP) - 2 * w * dLookP) * dt; lookP += dLookP * dt;
      const still = 1 - s3(ramp(t, T.turn - 1.5, T.turn - 0.3));          // nothing left of it when she turns
      tab.lookYaw[i] = lookY * still; tab.lookPitch[i] = lookP * still;
    }

    function at(t) {
      t = ((t % L) + L) % L;
      const f = t * HZ, i = Math.min(Math.floor(f), N - 1), u = f - i, o = {};
      for (const k in tab) o[k] = tab[k][i] + (tab[k][i + 1] - tab[k][i]) * u;
      if (tab.alpha[i] === 0 && tab.alpha[i + 1] === 0) o.alpha = 0;
      return o;
    }
    return { at, tab };
  }

  // ---- shape. Vertex: x, y (picture pixels), u, v, kind (0 wing, 1 body, 2 line), r, g, b, a
  const NU = 5, NV = 7, STRIDE = 9;
  const buf = new Float32Array(4096 * STRIDE);
  function frame(S) {
    const cp = Math.cos(S.psi), sp = Math.sin(S.psi), ct = Math.cos(S.pitch), st = Math.sin(S.pitch);
    const F = [cp * ct, st, sp * ct], U0 = [-cp * st, ct, -sp * st];
    const R0 = [F[1] * U0[2] - F[2] * U0[1], F[2] * U0[0] - F[0] * U0[2], F[0] * U0[1] - F[1] * U0[0]];
    const cb = Math.cos(S.bank), sb = Math.sin(S.bank);
    const U = [0, 1, 2].map(k => U0[k] * cb + R0[k] * sb), R = [0, 1, 2].map(k => R0[k] * cb - U0[k] * sb);
    return { F, U, R };
  }
  // local point (forward, up, right) -> picture pixels and depth
  const proj = (S, B, f, u, r) => [
    S.x + S.s * (B.F[0] * f + B.U[0] * u + B.R[0] * r),
    S.y - S.s * (B.F[1] * f + B.U[1] * u + B.R[1] * r),
    B.F[2] * f + B.U[2] * u + B.R[2] * r];

  function mesh(S) {
    let n = 0;
    const put = (x, y, u, v, kind, c) => { const o = n * STRIDE; buf[o] = x; buf[o + 1] = y; buf[o + 2] = u; buf[o + 3] = v; buf[o + 4] = kind; buf[o + 5] = c[0]; buf[o + 6] = c[1]; buf[o + 7] = c[2]; buf[o + 8] = c[3]; n++; };
    const B = frame(S), A = S.alpha;
    const quad = (a, b, c, d, uv, kind, col) => {                // a-b-c-d round the quad
      put(a[0], a[1], uv[0], uv[1], kind, col); put(b[0], b[1], uv[2], uv[1], kind, col); put(c[0], c[1], uv[2], uv[3], kind, col);
      put(a[0], a[1], uv[0], uv[1], kind, col); put(c[0], c[1], uv[2], uv[3], kind, col); put(d[0], d[1], uv[0], uv[3], kind, col);
    };
    const line = (p, q, w, col) => {                             // p, q: projected ends; w: width in picture pixels
      let dx = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const nx = -dy * w / 2, ny = dx * w / 2;
      quad([p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny], [0, -1, 1, 1], 2, col);
    };

    // a pair of wings. The sheet bends: the tips trail behind the root when the wings move fast.
    const bend = clamp(-0.05 * S.dphi, -0.55, 0.55), vmax = SHEET[3], FINE = 24;
    const cu = [0], cr = [0];                                    // the bent sheet's section: up, out at v = vmax*k/FINE
    for (let k = 1; k <= FINE; k++) {
      const ph = S.phi + bend * Math.pow((k - 0.5) / FINE, 1.5);
      cu.push(cu[k - 1] + Math.sin(ph) * vmax / FINE); cr.push(cr[k - 1] + Math.cos(ph) * vmax / FINE);
    }
    const section = v => {
      if (v <= 0) return [Math.sin(S.phi) * v, Math.cos(S.phi) * v];
      const f = Math.min(v / vmax, 1) * FINE, k = Math.min(Math.floor(f), FINE - 1), w = f - k;
      return [cu[k] + (cu[k + 1] - cu[k]) * w, cr[k] + (cr[k + 1] - cr[k]) * w];
    };
    const wing = sgn => {
      const P = [];
      let zc = 0;
      for (let j = 0; j <= NV; j++) {
        const [up, out] = section(SHEET[1] + (SHEET[3] - SHEET[1]) * j / NV);
        for (let i = 0; i <= NU; i++) {
          const q = proj(S, B, SHEET[0] + (SHEET[2] - SHEET[0]) * i / NU, up + 1.0, sgn * (out + 1.2));
          P.push(q); zc += q[2];
        }
      }
      // seen square on a wing is at its brightest
      const face = Math.abs(B.R[2] * Math.sin(S.phi) - sgn * B.U[2] * Math.cos(S.phi));
      return { P, zc: zc / P.length, lum: 0.8 + 0.2 * face };
    };
    // the wing that is further away is the darker, bluer one, as painted
    const tint = (w, other) => {
      const far = s3(clamp((other.zc - w.zc) / 30, 0, 1));
      w.col = [lerp(1, 0.6, far) * w.lum, lerp(1, 0.6, far) * w.lum, lerp(1, 0.92, far) * w.lum, A];
    };
    const emit = w => {
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const a = w.P[j * (NU + 1) + i], b = w.P[j * (NU + 1) + i + 1], c = w.P[(j + 1) * (NU + 1) + i + 1], d = w.P[(j + 1) * (NU + 1) + i];
        const u0 = i / NU, u1 = (i + 1) / NU, v0 = 1 - j / NV, v1 = 1 - (j + 1) / NV;
        put(a[0], a[1], u0, v0, 0, w.col); put(b[0], b[1], u1, v0, 0, w.col); put(c[0], c[1], u1, v1, 0, w.col);
        put(a[0], a[1], u0, v0, 0, w.col); put(c[0], c[1], u1, v1, 0, w.col); put(d[0], d[1], u0, v1, 0, w.col);
      }
    };
    const body = () => {
      const dark = [0.06, 0.085, 0.13, A], thin = [0.2, 0.25, 0.3, 0.6 * A];
      const w = Math.max(1.1, 1.25 * S.s);
      // legs: three a side, from under the chest to the finger (25 below the hinge) when it stands
      const k = S.legs;
      for (const sgn of [-1, 1]) for (const [f0, f1] of [[9, 15], [3, 4], [-4, -9]]) {
        const hip = proj(S, B, f0, -6.5, sgn * 2.5), knee = proj(S, B, lerp(f0 - 2, (f0 + f1) / 2, k), lerp(-9, -13, k), sgn * lerp(3.5, 8, k));
        const foot = proj(S, B, lerp(f0 - 6, f1, k), lerp(-8.5, -27, k), sgn * lerp(3, 7, k));
        line(hip, knee, w, thin); line(knee, foot, w * 0.85, thin);
      }
      const tail = proj(S, B, -45, -6, 0), head = proj(S, B, 19, -3.5, 0);
      let dx = head[0] - tail[0], dy = head[1] - tail[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const r = 5.2 * S.s, e = r * 0.9, nx = -dy * r, ny = dx * r;
      const a = [tail[0] - dx * e, tail[1] - dy * e], b = [head[0] + dx * e, head[1] + dy * e];
      quad([a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [0, -1, 1, 1], 1, dark);
      // antennae
      for (const sgn of [-1, 1]) {
        const p0 = proj(S, B, 19, -1.5, sgn * 1.5), p1 = proj(S, B, 31, 6, sgn * 6), p2 = proj(S, B, 43, 15, sgn * 12), p3 = proj(S, B, 47, 17.5, sgn * 14);
        line(p0, p1, w * 0.9, thin); line(p1, p2, w * 0.9, thin); line(p2, p3, w * 1.9, thin);
      }
    };
    const wr = wing(1), wl = wing(-1);
    tint(wr, wl); tint(wl, wr);
    const [back, frontW] = wr.zc < wl.zc ? [wr, wl] : [wl, wr];
    emit(back); body(); emit(frontW);
    return { data: buf, count: n };
  }

  window.Fly = { build, mesh, ROOT, STRIDE, SHEET };
})();
