// Hand in Hand: a cut-out puppet of the picture's pair. The giant leaps off his far foot (the picture's pose), lands on
// the near toe, stamps the far foot down and leaps again. The girl, hand in his, has her own skip against his:
// his leap lifts her and she flies out behind him, she comes down and hops twice on her own toes while he lands
// and gathers himself, then pushes off into the next; her head, the syringe she holds up, her pigtails and skirt
// follow all of it on springs. Ink flies at every landing. They cross to the right, he
// skids, jumps round and whips her about, and they skip back out.
// Everything is a function of the time alone and periodic in L (the stage is empty at the start and at the end).
//   Skip.run({ L })      ?t=<seconds> freezes time; window.Skip.at(t) draws one moment (for stills)
// Assets come from tools/prep.py: rig.js (window.BIO), parts.png, drops.png, paper.jpg, vignette.png, grain.png.
(function () {
  'use strict';
  const B = window.BIO, P = B.piv;
  const SW = 2560, SH = 1440, S = 0.95;
  const GY = 1168;                                   // where the giant's toes land (stage px)
  const qs = new URLSearchParams(location.search);
  const frozen = qs.has('t') ? parseFloat(qs.get('t')) : null;
  const DEG = Math.PI / 180, TAU = 2 * Math.PI;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const sat = u => clamp(u, 0, 1);
  const smooth = u => { u = sat(u); return u * u * (3 - 2 * u); };
  const sstep = (a, b, x) => smooth((x - a) / (b - a));
  const easeOut = u => 1 - (1 - sat(u)) * (1 - sat(u));
  function rng(seed) {                                 // mulberry32
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  // 2D affine [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (canvas order). mul(m, n) applies n first.
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const Tr = (x, y) => [1, 0, 0, 1, x, y];
  const Ro = a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
  const Sc = (x, y) => [x, 0, 0, y, 0, 0];
  const chain = (...ms) => ms.reduce(mul);
  const ap = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  const inv = m => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
  const about = (p, m) => chain(Tr(p[0], p[1]), m, Tr(-p[0], -p[1]));
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mix2 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  // keys [time, value, ease of the stretch that ends here]: 'io' (default), 'out', 'in', 'lin', or a power (u^n)
  function track(k, t) {
    if (t <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (t <= k[i][0]) {
      let u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); const e = k[i][2];
      u = e === 'out' ? easeOut(u) : e === 'in' ? u * u : e === 'lin' ? u : typeof e === 'number' ? Math.pow(u, e) : smooth(u);
      return lerp(k[i - 1][1], k[i][1], u);
    }
    return k[k.length - 1][1];
  }

  // ------------------------------------------------------------------ the puppet (source pixels)
  const C = [465, 625];                               // the pelvis: the body leans and squashes about it
  const O = P.origin;                                 // the far toe in the picture: on the ground at take-off
  const CX = (C[0] - O[0]) * S, CH = (O[1] - C[1]) * S;
  const NEAR = [(P.toe[0] - O[0]) * S, (O[1] - P.toe[1]) * S];    // the near toe in the picture: forward, up
  const L1 = dist(P.hip, P.knee), L2 = dist(P.knee, P.toe);
  const GYG = GY + (P.girlfoot[1] - O[1]) * S;       // the girl stands nearer to us
  const GREST = Math.atan2(P.girlfoot[0] - P.grip[0], P.girlfoot[1] - P.grip[1]) / DEG;   // her hang, degrees from straight down

  // ------------------------------------------------------------------ the choreography
  const TF = 0.58, TC = 0.36, T = TF + TC, PF = TF / T;   // flight, contact
  const HAP = 106, DIP = 56;                          // how high he flies, how deep he sinks (stage px)
  const STRIDE = 356, V = STRIDE / T;
  const G0 = 8 * HAP / (TF * TF), V0 = 4 * HAP / TF;
  const WF = 0.26, WL = 0.56;                         // contact: the far foot comes down, the near foot leaves
  const REACH_N = 196, REACH_F = V * (1 - WF) * TC;   // where the feet are put down, ahead of the body's origin
  const STAND_N = 150, STAND_F = 46, HSTAND = -18;    // standing: toes ahead of the origin, knees a little bent
  function dipCurve(w) {                              // the body in contact: arrives and leaves at the flight's speed
    const a = 2 * DIP / (V0 * TC), b = 0.5, n = V0 * (1 - b) * TC / DIP;
    if (w < a) return -DIP * (1 - (1 - w / a) * (1 - w / a));
    if (w < b) return -DIP;
    return -DIP * (1 - Math.pow((w - b) / (1 - b), n));
  }
  // one skip of his, by phase (0 = take-off): lean in degrees (+ = forward), squash of the body about the pelvis
  const LEAN = [[0, 5], [0.22, 0], [PF - 0.06, -5], [PF + 0.12, 4], [PF + 0.3, 7], [1, 5]];
  const SQUASH = [[0, 1.035], [0.2, 1.0], [PF, 1.012], [PF + 0.1, 0.95], [PF + 0.2, 0.955], [1, 1.035]];
  // The girl, by the same phase. He lifts her by the hand and she flies out behind him (rho: how far her feet trail,
  // degrees); she comes down just before he does and skips on on her own feet, hop, hop (PH: her three touch-downs),
  // then pushes off into his next leap. zg: how high she rides (0 = on tiptoe on the ground, below = knees bent);
  // in the air the hand's height decides.
  const RHO = [[0, -4], [0.10, 8], [0.30, 27], [0.46, 12], [0.585, -7], [0.70, -1], [0.86, -3], [1, -4]];
  const PH = { f1: 0.60, f1e: 0.668, o: 0.755, oe: 0.823, f2: 0.915, f2e: 1.03 };
  const ZG = [[0, -3], [0.03, 0], [PH.f1, 0], [0.65, -6], [0.8, -5], [0.955, -9], [1, -3]];
  // her hops: she pulls up on his hand as she springs (her arm folds under his glove), a tug as she leaps
  const GUP = [[0, 6], [0.07, 13], [0.22, 0], [PH.f1, 0], [PH.f1e, 3], [0.712, 17], [PH.o, 3], [0.785, 0], [PH.oe, 3], [0.869, 19], [PH.f2, 3],
    [0.955, 0], [1, 6]];

  // One skip at local time tau (0 = take-off), the body's origin at f0 + V tau. Forward coordinates.
  function cycle(tau, f0, ffPlant) {
    const p = tau / T, o = {};
    o.f = f0 + V * tau;
    const fl = tau < TF, u = tau / TF, w = (tau - TF) / TC;
    o.h = fl ? 4 * HAP * u * (1 - u) : dipCurve(w);
    o.lean = track(LEAN, p); o.ky = track(SQUASH, p); o.rho = track(RHO, p); o.zg = track(ZG, p); o.gup = track(GUP, p);
    const fnPlant = f0 + V * TF + REACH_N, tfPlant = TF + WF * TC;
    if (ffPlant === undefined) ffPlant = f0 + V * tfPlant + REACH_F;
    // near toe: where the picture has it at take-off (nq = 1), reaches down and forward, plants (nq = 0), lifts again
    o.nf = fnPlant; o.nz = 0;
    o.nq = fl ? 1 - sstep(0.36, 1, u) : w < WL ? 0 : Math.pow(smooth((w - WL) / (1 - WL)), 1.2);
    // far toe: pushes off, trails, swings through and stamps down under him
    if (tau < tfPlant) {
      const s = tau / tfPlant, e = sstep(0.12, 1, s);
      o.ff = lerp(f0, ffPlant, e) - 26 * Math.sin(Math.PI * sat(s / 0.5)) * (1 - s);
      o.fz = 62 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.85)), 0.9);
    } else { o.ff = ffPlant; o.fz = 0; }
    return o;
  }

  // The timeline
  const X_STOP = 1760;                                // the giant's centre line where he stops and turns
  const N1 = 6, N2 = 7;
  const tR1 = 0.5;                                    // first take-off, off screen
  const tS = tR1 + (N1 - 1) * T + TF;                 // the last landing: he stops
  const RIDE = REACH_N - STAND_N, SLIDE = 56, TD = 2 * (RIDE + SLIDE) / V;   // rides on over his toes, skidding
  const D_J = 1.15, HJ = 64, TJ = Math.sqrt(8 * HJ / G0), D_L = 0.98;
  const tJump = tS + D_J, tJLand = tJump + TJ, tR2 = tJLand + D_L;
  const TPUSH = 0.2;
  const tEnd = tR2 + N2 * T;
  const fTouch = X_STOP - CX - RIDE - SLIDE;          // origin (world x) when the last flight touches down
  const F1 = fTouch - ((N1 - 1) * STRIDE + V * TF);   // origin at the first take-off
  const FLAST = F1 + (N1 - 1) * STRIDE;
  const X2 = X_STOP + CX, F2 = STAND_F;               // facing left: world x = X2 - forward
  const c0 = cycle(TF - 1e-6, FLAST);                 // the pose he lands in
  const tf0 = WF * TC, FF_END = X_STOP - CX + STAND_F;
  const FF_PLANT = FF_END - SLIDE * (1 - easeOut(tf0 / TD));
  // the stop, the jump round and the landing: tracks in seconds after tS / tJump / tJLand
  const vJ = 4 * HJ / TJ;
  const K_H1 = [[0, 0], [2 * 78 / V0, -78, 'out'], [0.4, -72], [0.74, HSTAND], [0.8, HSTAND], [1.02, -58], [D_J, 0, vJ * 0.13 / 58]];
  const K_H2 = [[0, 0], [2 * 62 / vJ, -62, 'out'], [0.52, -14], [0.78, -60], [D_L, 0, V0 * TPUSH / 60]];
  const K_LEAN1 = [[0, c0.lean], [0.18, -9, 'out'], [0.62, 0], [0.8, 0], [1.02, 6], [D_J, 0]];
  const K_LEAN2 = [[0, 0], [0.2, 6, 'out'], [0.52, 0], [0.78, 9], [D_L, LEAN[0][1]]];
  const K_KY1 = [[0, c0.ky], [0.2, 0.932, 'out'], [0.7, 1], [0.8, 1], [1.02, 0.955], [D_J, 1.045]];
  const K_KY2 = [[0, 1], [0.2, 0.94, 'out'], [0.52, 1.005], [0.78, 0.95], [D_L, SQUASH[0][1]]];
  const HANG = 10 - Math.atan2(P.shoulder[0] - P.grip[0], P.grip[1] - P.shoulder[1]) / DEG;   // the arm as he skips, less his lean
  const K_ARM1 = [[0, HANG - c0.lean], [0.4, -6], [0.8, -4], [1.02, 9], [D_J, 12]];
  const K_ARM2 = [[0, 22], [0.45, 7], [0.78, -3], [D_L, HANG - LEAN[0][1]]];
  // the girl: her angle from straight down in degrees (+ = feet to the right), through the stop and the whip round
  const K_ZG1 = [[0, c0.zg], [0.12, 0], [D_J, 0]];
  const K_GUP1 = [[0.6, 0], [0.7, 15], [0.8, 0], [0.84, 0], [0.94, 18], [1.04, 0], [D_J, 0]];   // waiting, she bobs on her toes
  const K_ZG2 = [[0.55, 0], [0.9, -9], [D_L, ZG[0][1]]];
  const K_GUP2 = [[0.55, 0], [0.66, 17], [0.78, 0], [0.84, 0], [D_L, GUP[0][1]]];
  const K_GAM1 = [[0, GREST - c0.rho], [0.28, 3], [0.6, -30], [0.88, -8], [D_J, -15]];   // she skids too, leaning back, and rocks to a stop
  const K_GAM2 = [[0, -15], [0.14, -46], [0.3, -6], [0.5, 62], [0.68, 74], [0.96, 4], [1.14, 22], [1.3, 11], [TJ + D_L, -GREST + RHO[0][1]]];

  // The giant and the girl at time t: world numbers.
  function pose(t) {
    if (t < tR1 || t >= tEnd) return { vis: false };
    const g = { vis: true, face: 1, dir: 1, nq: 0, fq: 0 };
    let o;
    if (t < tS) {                                                     // ---- skipping to the right
      const k = Math.min(N1 - 1, Math.floor((t - tR1) / T));
      o = cycle(t - tR1 - k * T, F1 + k * STRIDE, k === N1 - 1 ? FF_PLANT : undefined);
      g.xc = o.f + CX; g.nx = o.nf; g.fx = o.ff; g.nq = o.nq;
      g.gamma = GREST - o.rho; g.zg = o.zg; g.gup = o.gup;
    } else if (t < tJump) {                                           // ---- the stop: a skid, a breath, a crouch
      const tau = t - tS, e = easeOut(tau / TD);
      o = {};
      g.xc = fTouch + (RIDE + SLIDE) * e + CX;
      g.nx = fTouch + REACH_N + SLIDE * e; o.nz = 0;
      if (tau < tf0) { const cc = cycle(TF + tau, FLAST, FF_PLANT); g.fx = cc.ff; o.fz = cc.fz; }
      else { g.fx = FF_END - SLIDE * (1 - e); o.fz = 0; }
      o.h = track(K_H1, tau); o.lean = track(K_LEAN1, tau); o.ky = track(K_KY1, tau); o.arm = track(K_ARM1, tau);
      g.gamma = track(K_GAM1, tau); g.zg = track(K_ZG1, tau); g.gup = track(K_GUP1, tau);
      g.nq = smooth((tau - (D_J - 0.07)) / 0.15);                     // the near foot leaves a moment before the far one
    } else if (t < tJLand) {                                          // ---- the jump round
      const u = (t - tJump) / TJ, tau = t - tJump;
      o = { nz: 0, fz: 0 };
      o.h = 4 * HJ * u * (1 - u);
      g.face = Math.cos(Math.PI * smooth((u - 0.1) / 0.8));
      o.lean = 0; o.ky = lerp(1.045, 1.0, sat(u * 2)); o.arm = lerp(12, 22, smooth(u * 1.5));
      g.xc = X_STOP; g.stand = true;
      const q = Math.min(smooth((tau + 0.07) / 0.15), 1 - smooth((tau - (TJ - 0.13)) / 0.13));
      g.nq = q; g.fq = Math.min(smooth(tau / 0.1), 1 - smooth((tau - (TJ - 0.13)) / 0.13));
      g.gamma = track(K_GAM2, tau);
      g.gface = Math.cos(Math.PI * smooth((tau - 0.34) / 0.3));
    } else if (t < tR2) {                                             // ---- the landing, the rebound, the wind-up
      const tau = t - tJLand, b = sat((tau - (D_L - TPUSH)) / TPUSH);
      o = { nz: 0, fz: 0 };
      g.face = -1; g.dir = -1;
      o.h = track(K_H2, tau); o.lean = track(K_LEAN2, tau); o.ky = track(K_KY2, tau); o.arm = track(K_ARM2, tau);
      g.xc = X_STOP - STAND_F * b * b;                                // rides forward (left) onto the far toe
      g.nx = X2 - STAND_N; g.fx = X2 - STAND_F;
      g.nq = smooth((b - 0.2) / 0.8);
      g.gamma = track(K_GAM2, tau + TJ);
      g.zg = tau < 0.55 ? 0 : track(K_ZG2, tau); g.gup = tau < 0.55 ? 0 : track(K_GUP2, tau);   // down from the whip she bobs once on her toes, then crouches with him
      g.gface = Math.cos(Math.PI * smooth((tau + TJ - 0.34) / 0.3));
    } else {                                                          // ---- skipping back to the left
      const k = Math.min(N2 - 1, Math.floor((t - tR2) / T));
      o = cycle(t - tR2 - k * T, F2 + k * STRIDE);
      g.dir = -1; g.face = -1;
      g.xc = X2 - o.f - CX; g.nx = X2 - o.nf; g.fx = X2 - o.ff; g.nq = o.nq;
      g.gamma = -GREST + o.rho; g.zg = o.zg; g.gup = o.gup;
    }
    g.h = o.h; g.lean = o.lean; g.ky = o.ky; g.arm = o.arm; g.nz = o.nz; g.fz = o.fz;
    if (g.gface === undefined) g.gface = g.face;
    return g;
  }

  // ------------------------------------------------------------------ pose -> matrices
  function solve(g) {
    const yc = GY - g.h - CH, kx = 1 / Math.sqrt(g.ky);
    const Mb = chain(Tr(g.xc, yc), Sc(g.face, 1), Ro(g.lean * DEG), Sc(S * kx, S * g.ky), Tr(-C[0], -C[1]));
    const m = { body: Mb };
    // toes: planted in the world, or (in the jump) blending to where the picture has them
    let nT, fT;
    if (g.stand) {                                    // turning: the picture's space, by hand (no inverse edge-on)
      const y = C[1] + (g.h + CH) / (S * g.ky);
      nT = [C[0] + (STAND_N - CX) / (S * kx), y]; fT = [C[0] + (STAND_F - CX) / (S * kx), y];
    } else {
      const Mi = inv(Mb);
      nT = ap(Mi, [g.nx, GY - g.nz]); fT = ap(Mi, [g.fx, GY - g.fz]);
    }
    nT = mix2(nT, P.toe, g.nq); fT = mix2(fT, P.fartoe, g.fq);
    // near leg: two bones, the knee stays in front
    const H = P.hip;
    const d = clamp(dist(H, nT), Math.abs(L1 - L2) + 2, L1 + L2 - 2);
    const base = ang(H, nT), a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const ka = base - a, K = [H[0] + L1 * Math.cos(ka), H[1] + L1 * Math.sin(ka)];
    const tip = [H[0] + d * Math.cos(base), H[1] + d * Math.sin(base)];
    m.thigh = mul(Mb, about(H, Ro(ka - ang(H, P.knee))));
    m.shin = chain(Mb, Tr(K[0], K[1]), Ro(ang(K, tip) - ang(P.knee, P.toe)), Tr(-P.knee[0], -P.knee[1]));
    // far leg: one bone that stretches
    const Hf = P.farhip, r0 = ang(Hf, P.fartoe), r1 = ang(Hf, fT);
    const st = clamp(dist(Hf, fT) / dist(Hf, P.fartoe), 0.72, 1.14);
    m.far = chain(Mb, Tr(Hf[0], Hf[1]), Ro(r1 - Math.PI / 2), Sc(1, st), Ro(-(r0 - Math.PI / 2)), Tr(-Hf[0], -Hf[1]));
    m.farToe = ap(m.far, P.fartoe); m.nearToe = ap(m.shin, P.toe);
    // The held arm and the girl. His hand is where the posed arm (straight) puts it, or higher: as high as she
    // needs to ride (zg above her ground). Then the elbow gives, so the hand rises without swinging about.
    const f = g.gface, rot0 = (GREST * f - g.gamma) * DEG;
    const armV = -(Math.atan2(P.shoulder[0] - P.grip[0], P.grip[1] - P.shoulder[1]) + g.lean * DEG);   // straight down
    const arm = g.arm === undefined ? armV + 10 * DEG : g.arm * DEG;      // skipping: it hangs a little behind him
    const Mrig = mul(Mb, about(P.shoulder, Ro(arm)));
    let hand = ap(Mrig, P.grip);
    const Rg = mul(Ro(rot0), Sc(S * f, S)), fo = ap(Rg, [P.girlfoot[0] - P.grip[0], P.girlfoot[1] - P.grip[1]]);
    const need = GYG - (g.zg || 0) - fo[1];                              // the hand's height that puts her toes there
    if (hand[1] > need && Math.abs(g.face) > 0.6) {
      hand = [hand[0], need];
      const Mi = inv(Mb), Tl = ap(Mi, hand), Sh = P.shoulder;
      const la = dist(Sh, P.elbow), lb = dist(P.elbow, P.grip), dm = la + lb;
      const sh = dm - Math.min(dm, dist(Sh, Tl)), d = Math.max(Math.abs(la - lb) + 2, dm - Math.sqrt(sh * sh + 0.36));
      const base = ang(Sh, Tl), ea = base + Math.acos(clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1));   // the elbow goes back
      const E = [Sh[0] + la * Math.cos(ea), Sh[1] + la * Math.sin(ea)], tip = [Sh[0] + d * Math.cos(base), Sh[1] + d * Math.sin(base)];
      m.uarm = mul(Mb, about(Sh, Ro(ea - ang(Sh, P.elbow))));
      m.farm = chain(Mb, Tr(E[0], E[1]), Ro(ang(E, tip) - ang(P.elbow, P.grip)), Tr(-P.elbow[0], -P.elbow[1]));
      hand = ap(m.farm, P.grip);
    } else m.uarm = m.farm = Mrig;
    const up = (g.gup || 0) / S;                                          // she pulls herself up on his hand
    m.girl = chain(Tr(hand[0], hand[1]), Rg, Tr(-P.grip[0], -P.grip[1] - up));
    m.grip = hand; m.girlFoot = ap(m.girl, P.girlfoot);
    return m;
  }

  // ------------------------------------------------------------------ what happens when: landings and their ink
  // events { t, x, y, power, dir, kind }: 'land' near toe, 'stamp' far foot, 'girl' her feet, 'hop' leaving the ground
  const EV = [];
  (function events() {
    for (let k = 0; k < N1; k++) {
      const f0 = F1 + k * STRIDE, last = k === N1 - 1;
      EV.push({ t: tR1 + k * T + TF, x: f0 + V * TF + REACH_N, y: GY, power: last ? 1.6 : 1, dir: 1, kind: 'land', skid: last ? SLIDE : 0 });
      EV.push({ t: tR1 + k * T + TF + WF * TC, x: last ? FF_PLANT : f0 + V * (TF + WF * TC) + REACH_F, y: GY, power: last ? 1.1 : 0.7, dir: 1, kind: 'stamp', skid: last ? SLIDE * 0.8 : 0 });
    }
    EV.push({ t: tJump, x: X_STOP - CX + STAND_F + 40, y: GY, power: 0.55, dir: 1, kind: 'hop' });
    EV.push({ t: tJLand, x: X2 - STAND_N, y: GY, power: 1.2, dir: -1, kind: 'land' });
    EV.push({ t: tJLand + 0.03, x: X2 - STAND_F, y: GY, power: 0.8, dir: -1, kind: 'stamp', nofan: true });
    EV.push({ t: tR2 - 0.04, x: X2 - STAND_F, y: GY, power: 0.7, dir: -1, kind: 'stamp' });
    for (let k = 0; k < N2; k++) {
      const f0 = F2 + k * STRIDE;
      EV.push({ t: tR2 + k * T + TF, x: X2 - (f0 + V * TF + REACH_N), y: GY, power: 1, dir: -1, kind: 'land' });
      EV.push({ t: tR2 + k * T + TF + WF * TC, x: X2 - (f0 + V * (TF + WF * TC) + REACH_F), y: GY, power: 0.7, dir: -1, kind: 'stamp' });
    }
  })();

  // ------------------------------------------------------------------ the girl's own skip
  // Her body hangs from his hand (solve); the rest of her has a life of its own. Legs: one bone each from a hip
  // hidden under the skirt to the toe; a toe is either planted on the ground or held in a pose (offsets forward
  // and down from where the picture has it, in her own frame). Head, syringe arm, skirt, pigtails and the legs'
  // lag are springs that follow her movement, worked out once along the whole timeline.
  const base = t => { const g = pose(t); return g.vis ? { g, m: solve(g) } : null; };
  const HIPS = [P.ghip, [P.ghip[0] - 9, P.ghip[1] + 2]], TOE0 = P.girlfoot;     // leg 0 near, leg 1 far
  const KU = [50, -34], LL = [98, -44], LT = [-84, -12], ST = [[8, 0], [-22, 3]];   // knee up; leap: lead, trail; standing
  const K_LEAD = [[0.03, KU], [0.2, LL], [0.47, [78, -30]]];
  const K_TRAIL = [[0.03, [-24, -4]], [0.26, LT], [0.5, [-34, -24]], [0.66, KU]];
  const LEADPX = 18;
  const HEAD = { w: 16.5, z: 0.3, kx: 0.4, ky: 0.5, kt: 0.85, kn: 0.36 };   // the head's spring; how far it shifts, tilts, nods
  const RIFLE = { w: 10, z: 0.18, l: 170, dip: 1.0 };                     // the rifle's spring, its length, how much a landing dips it
  const TAILS = 1.25;                                                     // the pigtails a little bigger than drawn, to read
  const track2 = (k, t) => [track(k.map(e => [e[0], e[1][0]]), t), track(k.map(e => [e[0], e[1][1]]), t)];
  const RUNS = [null, { t0: tR1, n: N1, dir: 1 }, { t0: tR2, n: N2, dir: -1 }];
  const plantCache = new Map();
  function plantX(run, k, w) {                        // where a foot goes down: a little ahead of her at that moment
    const key = run * 1000 + k * 3 + (w === 'f1' ? 0 : w === 'o' ? 1 : 2);
    if (!plantCache.has(key)) { const b = base(RUNS[run].t0 + (k + PH[w]) * T); plantCache.set(key, b ? b.m.girlFoot[0] + RUNS[run].dir * LEADPX : null); }
    return plantCache.get(key);
  }
  // a leg in a run: { x: world x of the plant in play (or null), q: 0 planted .. 1 posed, off: the pose }
  function runLeg(run, t, i) {
    const tt = (t - RUNS[run].t0) / T, k = Math.floor(tt - 0.03), ph = tt - k;   // ph in [0.03, 1.03): her leap, then her ground time
    if (k < 0) return { x: null, q: 1, off: ST[i] };
    const first = (k + i) % 2 === 0, px = w => plantX(run, k, w);
    const up = (a, d) => smooth((ph - a) / d), down = (b, d) => 1 - smooth((ph - (b - d)) / d);
    if (first) {                                      // leads in the leap, lands first, knee up, lands again, pushes off
      if (ph < PH.f1) return { x: px('f1'), q: down(PH.f1, 0.11), off: track2(K_LEAD, ph) };
      if (ph < PH.f1e) return { x: px('f1'), q: 0, off: KU };
      if (ph < PH.f2) return { x: ph < 0.79 ? px('f1') : px('f2'), q: Math.min(up(PH.f1e, 0.07), down(PH.f2, 0.085)), off: KU };
      return { x: px('f2'), q: 0, off: KU };
    }
    const prev = k > 0 ? plantX(run, k - 1, 'f2') : null;   // trails in the leap (it pushed off), swings through, lands between
    if (ph < PH.o) return { x: ph < 0.35 ? prev : px('o'), q: Math.min(prev === null ? 1 : up(0.03, 0.08), down(PH.o, 0.085)), off: track2(K_TRAIL, ph) };
    if (ph < PH.oe) return { x: px('o'), q: 0, off: KU };
    return { x: px('o'), q: up(PH.oe, 0.07), off: KU };
  }
  const rot2 = (v, a) => { const c = Math.cos(a), s_ = Math.sin(a); return [v[0] * c - v[1] * s_, v[0] * s_ + v[1] * c]; };
  // her toes in her own frame at time t (given the body matrix and the legs' lag)
  function legs(t, g, m, lag) {
    const ok = Math.abs(g.gface) > 0.3, Mi = ok ? inv(m.girl) : null, out = [];
    const posed = (i, off) => { const r = rot2([TOE0[0] + off[0] - HIPS[i][0], TOE0[1] + off[1] - HIPS[i][1]], lag * DEG); return [HIPS[i][0] + r[0], HIPS[i][1] + r[1]]; };
    const mode = (run, i) => { const L = runLeg(run, t, i), free = posed(i, L.off); return (L.x === null || L.q >= 1 || !ok) ? free : mix2(ap(Mi, [L.x, GYG]), free, L.q); };
    for (let i = 0; i < 2; i++) {
      let p;
      if (t < tS) p = mode(1, i);
      else if (t >= tR2) { p = mode(2, i); const b = smooth((t - tR2) / 0.14); if (b < 1) p = mix2(posed(i, ST[i]), p, b); }
      else { p = posed(i, ST[i]); const b = smooth((t - tS) / 0.12); if (b < 1) p = mix2(mode(1, i), p, b); }
      if (ok) { const w = ap(m.girl, p); if (w[1] > GYG) p = ap(Mi, [w[0], GYG]); }       // never through the ground
      out.push(p);
    }
    return out;
  }
  // What follows her movement, worked out once along the whole timeline (240 steps a second):
  //   head    a weight on the neck: it lags when she is pulled away, sinks and nods when she lands, settles
  //   rifle   the syringe she holds up keeps its own direction while she swings, is thrown by every jolt, overshoots
  //   skirt, pigtails, the legs' lag
  const DT = 1 / 240, NS = Math.ceil((tEnd - tR1) / DT) + 2;
  const SP = {}; for (const k of ['tl', 'tr', 'sk', 'sy', 'ar', 'lg', 'hx', 'hy', 'ha']) SP[k] = new Float32Array(NS);
  const A0 = [ang(P.gtailL, P.gtailLtip), ang(P.gtailR, P.gtailRtip)];
  (function springs() {
    const wrap = a => a - TAU * Math.round(a / TAU);
    const st = { tl: [A0[0], 0], tr: [A0[1], 0], sk: [0, 0], sy: [1, 0], lg: [0, 0] };
    const step = (s_, target, w, z, ang_) => { const e = ang_ ? wrap(target - s_[0]) : target - s_[0]; s_[1] += (w * w * e - 2 * z * w * s_[1]) * DT; s_[0] += s_[1] * DT; };
    let prev = null, psv = null, hd = null, rf = null, out = { ar: 0, hx: 0, hy: 0, ha: 0 };
    for (let i = 0; i < NS; i++) {
      const b = base(tR1 + i * DT);
      if (b) {
        const f = b.g.gface < 0 ? -1 : 1;
        const cur = { head: ap(b.m.girl, P.ghead), waist: ap(b.m.girl, P.gwaist), neck: ap(b.m.girl, P.gneck), sh: ap(b.m.girl, P.gshoulder), rot: (GREST * b.g.gface - b.g.gamma) };
        const rotR = cur.rot * DEG;
        if (prev) {
          const vel = k => [(cur[k][0] - prev[k][0]) / DT, (cur[k][1] - prev[k][1]) / DT];
          const hv = vel('head'), wv = vel('waist'), nv = vel('neck'), sv = vel('sh');
          const rr_ = (cur.rot - prev.rot) / DT;                                  // her turning, degrees a second
          // pigtails stream away from where her head is going, and hang when it is still
          // (never forwards over her face: at most a little below straight back)
          const bx = Math.min(-0.18, -hv[0] * f / 380), by = Math.min(-hv[1] / 330 + 0.35, 0.5 * -bx + 0.1);
          const ta = Math.atan2(by, bx * f);
          step(st.tl, ta - 0.14 * f, 12.5, 0.22, true); step(st.tr, ta + 0.1 * f, 10.5, 0.2, true);
          // skirt: hangs back towards straight down when she swings, drags behind her, lags her turning
          step(st.sk, clamp(-0.6 * cur.rot * f + wv[0] * f * 0.02 - rr_ * f * 0.05, -40, 40), 11, 0.24);
          // long and narrow going up, short and wide coming down
          step(st.sy, 1 + clamp(-wv[1] / 1900, -0.17, 0.17), 17, 0.3);
          step(st.lg, clamp(-rr_ * f * 0.07, -30, 30), 12, 0.36);
          // head: follows the neck on a spring; what it is behind by, in her own frame, tilts and sinks it
          if (!hd) hd = [cur.neck[0], cur.neck[1], nv[0], nv[1]];
          for (let k = 0; k < 2; k++) { hd[2 + k] += (HEAD.w * HEAD.w * (cur.neck[k] - hd[k]) + 2 * HEAD.z * HEAD.w * (nv[k] - hd[2 + k])) * DT; hd[k] += hd[2 + k] * DT; }
          const dx = hd[0] - cur.neck[0], dy = hd[1] - cur.neck[1], cr = Math.cos(rotR), sr = Math.sin(rotR);
          const lx = (dx * cr + dy * sr) * f, ly = -dx * sr + dy * cr;                  // behind her (-) / ahead (+), below (+)
          const soft = (v, m_) => m_ * Math.tanh(v / m_);
          out.hx = soft(lx * HEAD.kx, 7); out.hy = soft(ly * HEAD.ky, ly > 0 ? 9 : 6);
          out.ha = soft(Math.atan2(lx, 44) / DEG * HEAD.kt + ly * HEAD.kn, 16);
          // rifle: its direction (world) is drawn to hers by her grip, and thrown by how her shoulder is jolted
          if (!rf) rf = [rotR, rr_ * DEG];
          let ax = 0, ay = 0;
          if (psv) { ax = clamp((sv[0] - psv[0]) / DT, -3e5, 3e5); ay = clamp((sv[1] - psv[1]) / DT, -3e5, 3e5); }
          const acc = RIFLE.w * RIFLE.w * (rotR - rf[0]) + 2 * RIFLE.z * RIFLE.w * (rr_ * DEG - rf[1])
            - (ax * Math.cos(rf[0]) + ay * Math.sin(rf[0])) / RIFLE.l - RIFLE.dip * ay * f / RIFLE.l;
          rf[1] += acc * DT; rf[0] += rf[1] * DT;
          const lim = clamp(rf[0] - rotR, f > 0 ? -1.05 : -0.8, f > 0 ? 0.8 : 1.05);      // her wrist only gives so far
          if (lim !== rf[0] - rotR) { rf[0] = rotR + lim; rf[1] = rr_ * DEG; }
          out.ar = (rf[0] - rotR) / DEG * f;
          psv = sv;
        }
        prev = cur;
      } else { prev = psv = hd = rf = null; out = { ar: 0, hx: 0, hy: 0, ha: 0 }; }
      SP.tl[i] = st.tl[0]; SP.tr[i] = st.tr[0]; SP.sk[i] = st.sk[0]; SP.sy[i] = st.sy[0]; SP.lg[i] = st.lg[0];
      SP.ar[i] = out.ar; SP.hx[i] = out.hx; SP.hy[i] = out.hy; SP.ha[i] = out.ha;
    }
  })();
  function sprung(t) {
    const x = clamp((t - tR1) / DT, 0, NS - 1.001), i = Math.floor(x), u = x - i, o = {};
    for (const k in SP) o[k] = lerp(SP[k][i], SP[k][i + 1], u);
    return o;
  }
  // everything of hers but the body: matrices for the pieces
  function girl(t, g, m) {
    const e = sprung(t), f = g.gface, o = { e };
    const L = legs(t, g, m, e.lg);
    o.legs = L.map((p, i) => chain(m.girl, Tr(p[0], p[1]), Ro(ang(p, HIPS[i]) - ang(TOE0, HIPS[i])), Tr(-TOE0[0], -TOE0[1])));
    o.toes = L.map(p => ap(m.girl, p));
    const sy = clamp(e.sy, 0.8, 1.2);
    o.skirt = mul(m.girl, about(P.gwaist, mul(Ro(clamp(e.sk, -50, 50) * DEG), Sc(1 - 0.85 * (sy - 1), sy))));
    o.arm = mul(m.girl, about(P.gshoulder, Ro(e.ar * DEG)));
    o.head = chain(m.girl, Tr(e.hx / S, e.hy / S), about(P.gneck, Ro(e.ha * DEG)));
    const tail = (root, a0, th) => { const r = ap(o.head, root), a0w = Math.atan2(Math.sin(a0), (f < 0 ? -1 : 1) * Math.cos(a0)); return chain(Tr(r[0], r[1]), Ro(th - a0w), Sc(S * f * TAILS, S * TAILS), Tr(-root[0], -root[1])); };
    o.tailL = tail(P.gtailL, A0[0], e.tl); o.tailR = tail(P.gtailR, A0[1], e.tr);
    return o;
  }
  // her touch-downs: a little ink each time a toe comes down
  (function steps() {
    const was = [true, true], last = [-9, -9];
    for (let t = tR1; t < tEnd; t += 1 / 240) {
      const b = base(t);
      if (!b) { was[0] = was[1] = true; continue; }
      const G = girl(t, b.g, b.m);
      for (let i = 0; i < 2; i++) {
        const down = G.toes[i][1] > GYG - 1.2;
        if (down && !was[i] && t - last[i] > 0.2) { EV.push({ t, x: G.toes[i][0], y: GYG, power: 0.3, dir: b.g.dir, kind: 'girl' }); last[i] = t; }
        was[i] = down;
      }
    }
    for (let i = EV.length - 1; i >= 0; i--) { const e = EV[i]; if (e.x < (e.dir > 0 ? -460 : -300) || e.x > SW + 300) EV.splice(i, 1); }
    EV.sort((a, b) => a.t - b.t);
  })();

  // The ink each event throws: droplets on ballistic paths (comets: a head and a thinning tail), blades that shoot
  // out low and let go, foam that wells up at the foot, the picture's own splash under the foot for a moment,
  // and what stays on the paper for a while.
  const PART = [], BLADE = [], FOAM = [], STAIN = [], SPR = [];
  const STAIN_LIFE = [2.0, 3.0];
  (function ink() {
    const R = rng(20261118);
    const rr = (a, b) => a + (b - a) * R();
    for (const e of EV) {
      const pw = e.power, girl = e.kind === 'girl', hop = e.kind === 'hop', sq = Math.sqrt(pw);
      const n = Math.round((girl ? 22 : hop ? 16 : e.kind === 'stamp' ? 26 : 40) * pw);
      for (let i = 0; i < n; i++) {
        const fwd = R() < (girl || hop ? 0.5 : 0.74) ? 1 : -1, hi = R();
        const el = (fwd > 0 ? lerp(10, 84, hi * hi) : lerp(30, 82, hi)) * DEG;        // forward: low and fast; back: up
        const sp = (fwd > 0 ? rr(360, 1300) : rr(240, 760)) * sq * (girl ? 0.75 : 1);
        const big = R(), r = big > 0.92 ? rr(6.8, 10.5) : big > 0.55 ? rr(3.4, 6.2) : rr(1.6, 3.2);
        const gy = e.y + rr(-4, 50), g = 2600, y0 = e.y - rr(0, 16), x0 = e.x + rr(-24, 60) * e.dir;
        const vx = Math.cos(el) * sp * fwd * e.dir, vy = -Math.sin(el) * sp, drag = rr(1.0, 2.6);
        const life = (-vy + Math.sqrt(vy * vy + 2 * g * Math.max(1, gy - y0))) / g;       // when it comes down
        PART.push({ t0: e.t + rr(0, 0.04), x0, y0, vx, vy, g, r, life, drag, spr: r > 6.8 ? Math.floor(R() * 8) : -1, rot: rr(0, TAU),
          tail: R() < 0.22 ? rr(0.12, 0.2) : rr(0.035, 0.09) });
        if (r > 2.4 && R() < 0.7) STAIN.push({ t0: e.t + life, x: x0 + vx * (1 - Math.exp(-drag * life)) / drag, y: gy, rx: r * rr(1.3, 2.4), ry: r * rr(0.4, 0.65), life: rr(STAIN_LIFE[0] * 0.7, STAIN_LIFE[1] * 0.8) * (girl ? 0.6 : 1) });
      }
      const nb = girl ? 1 : hop ? 3 : Math.round((e.kind === 'stamp' ? 5 : 10) * pw);
      for (let i = 0; i < nb; i++) {
        const fwd = R() < 0.78 ? 1 : -1, steep = R() < 0.25;
        BLADE.push({ t0: e.t + rr(0, 0.03), x: e.x + rr(-16, 56) * e.dir, y: e.y + rr(6, 40), a: (steep ? rr(40, 78) : fwd > 0 ? rr(5, 30) : rr(14, 40)) * DEG, dir: fwd * e.dir,
          len: (steep ? rr(110, 230) : rr(190, 470)) * sq * (girl ? 0.5 : 1), w: rr(7, 15) * (girl ? 0.6 : 1) * Math.min(1.25, sq), bend: rr(-0.02, 0.16), knob: R() < 0.5 ? rr(4.5, 9) : 0, dur: rr(0.24, 0.4) });
      }
      const nf = girl ? 1 : hop ? 4 : Math.round((e.kind === 'stamp' ? 6 : 11) * pw);
      for (let i = 0; i < nf; i++) {
        const lobes = []; for (let j = 0; j < 4; j++) lobes.push([rr(-1.1, 1.1), rr(-0.5, 0.35), rr(0.45, 0.9)]);
        FOAM.push({ t0: e.t + rr(0, 0.035), x: e.x + rr(-70, 110) * e.dir, y: e.y + rr(10, 34), r: rr(12, 30) * sq * (girl ? 0.75 : 1), rise: rr(4, 38) * sq, drift: rr(0, 80) * e.dir, life: rr(0.24, 0.5), fleck: R() < 0.45, fa: rr(0.3, 2.8), lobes });
      }
      // the picture's own splash: the fan thrown forward by the far foot
      if (e.kind === 'stamp' && !e.nofan) SPR.push({ t0: e.t, name: 'fan', x: e.x, y: e.y, dir: e.dir, anchor: O, grow: 0.09, hold: 0.3, fade: 0.2, s: lerp(0.8, 1, sat(pw / 0.7)) });
      const st = (x, y, rx, ry, t0) => STAIN.push({ t0, x, y, rx, ry, life: rr(STAIN_LIFE[0], STAIN_LIFE[1]) * (girl ? 0.6 : 1), streak: true, lean: rr(0.6, 1.4), tilt: rr(-3, 3), bow: rr(-4, 4) });
      const nst = girl ? (R() < 0.5 ? 1 : 0) : hop ? 2 : e.kind === 'stamp' ? 2 : 4;
      for (let i = 0; i < nst; i++) st(e.x + rr(-50, 170) * e.dir, e.y + rr(10, 54), rr(34, 150) * sq, rr(2, 5), e.t + rr(0.04, 0.12));
      if (e.skid) for (let i = 0; i < 3; i++) st(e.x + (e.skid * 0.4 + rr(-16, 16)) * e.dir, e.y + rr(6, 24), e.skid * rr(0.9, 1.3), rr(3, 5.5), e.t + 0.04 * i);
    }
  })();

  // ------------------------------------------------------------------ drawing
  const load = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('cannot load ' + src)); im.src = src; });
  const rgb = a => `rgb(${a[0]},${a[1]},${a[2]})`;
  const INK = rgb(B.ink), TAN = 'rgb(170,156,122)';

  async function run(cfg) {
    const L = cfg.L;
    const lastInk = Math.max(...STAIN.map(s => s.t0 + s.life), ...PART.map(p => p.t0 + p.life));
    if (lastInk > L - 0.3 || tEnd > L) console.error('the loop is too short for the timeline', lastInk, tEnd);
    document.documentElement.style.cssText = document.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
    const view = document.createElement('canvas'); view.style.cssText = 'position:fixed;left:0;top:0;display:block';
    document.body.appendChild(view);
    const stage = document.createElement('canvas'); stage.width = SW; stage.height = SH;
    const c = stage.getContext('2d'); c.imageSmoothingQuality = 'high';
    const [parts, drops, paper, vig, grain] = await Promise.all(['parts.png', 'drops.png', 'paper.jpg', 'vignette.png', 'grain.png'].map(load));

    // -- the last pass: the paper's light falloff over everything, then its grain (the figures are printed on it)
    const gl = view.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; uniform vec4 crop; void main(){ uv = crop.xy + vec2(p.x*0.5+0.5, 0.5-p.y*0.5)*crop.zw; gl_Position = vec4(p,0.,1.); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `precision highp float; varying vec2 uv; uniform sampler2D st, vg, gr; uniform float vmax, gs;
      void main(){ vec3 col = texture2D(st, uv).rgb * texture2D(vg, uv).rgb * vmax;
        float n = (texture2D(gr, uv * vec2(${SW}.0, ${SH}.0) / ${B.grainSize}.0).r - 128.0/255.0) / gs;
        gl_FragColor = vec4(col + n, 1.0); }`));
    gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = (unit, im, wrap, filt) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      if (im) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
    };
    tex(0, null, gl.CLAMP_TO_EDGE, gl.LINEAR); tex(1, vig, gl.CLAMP_TO_EDGE, gl.LINEAR); tex(2, grain, gl.MIRRORED_REPEAT, gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(prog, 'st'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'vg'), 1); gl.uniform1i(gl.getUniformLocation(prog, 'gr'), 2);
    gl.uniform1f(gl.getUniformLocation(prog, 'vmax'), B.vmax); gl.uniform1f(gl.getUniformLocation(prog, 'gs'), B.grainScale);
    const uCrop = gl.getUniformLocation(prog, 'crop');

    const setT = m => c.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const ident = () => c.setTransform(1, 0, 0, 1, 0, 0);
    const piece = (name, m) => { const r = B.parts[name]; setT(m); c.drawImage(parts, r[0], r[1], r[2], r[3], r[4], r[5], r[2], r[3]); };
    const drop = (name, m) => { const r = B.drops[name]; setT(m); c.drawImage(drops, r[0], r[1], r[2], r[3], r[4], r[5], r[2], r[3]); };

    function comet(x, y, tx, ty, r) {                   // head at (x, y), tail back to (tx, ty)
      const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
      c.beginPath();
      if (d > r * 1.05) { const a = Math.atan2(dy, dx), o = Math.acos(clamp(r / d, -1, 1)); c.arc(x, y, r, a + o, a - o + TAU); c.lineTo(tx, ty); }
      else c.arc(x, y, r, 0, TAU);
      c.closePath(); c.fill();
    }
    // a brush stroke along a curve from base to tip (control point ctl), the part [u0, 1] of it, half-width w(u, s)
    function stroke(bx, by, cx, cy, tx, ty, u0, w) {
      const n = 14, A = [], Bq = [];
      for (let i = 0; i <= n; i++) {
        const s = i / n, u = lerp(u0, 1, s), v = 1 - u;
        const x = v * v * bx + 2 * v * u * cx + u * u * tx, y = v * v * by + 2 * v * u * cy + u * u * ty;
        let dx = v * (cx - bx) + u * (tx - cx), dy = v * (cy - by) + u * (ty - cy); const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        const h = w(u, s); A.push(x - dy * h, y + dx * h); Bq.push(x + dy * h, y - dx * h);
      }
      c.beginPath(); c.moveTo(A[0], A[1]);
      for (let i = 1; i <= n; i++) c.lineTo(A[2 * i], A[2 * i + 1]);
      for (let i = n; i >= 0; i--) c.lineTo(Bq[2 * i], Bq[2 * i + 1]);
      c.closePath(); c.fill();
    }
    function sprite(s, t) {                              // the picture's splash: wells up, stands, sinks into the paper
      const a = t - s.t0; if (a < 0 || a > s.grow + s.hold + s.fade) return;
      const up = easeOut(a / s.grow), dn = smooth((a - s.grow - s.hold) / s.fade);
      c.globalAlpha = 1 - dn;
      const kx = s.s * lerp(0.6, 1, up) * (1 + 0.1 * dn), ky = s.s * lerp(0.35, 1, up) * (1 - 0.4 * dn);
      drop(s.name, chain(Tr(s.x, s.y), Sc(s.dir * S * kx, S * ky), Tr(-s.anchor[0], -s.anchor[1])));
      ident(); c.globalAlpha = 1;
    }

    function draw(t) {
      ident(); c.globalAlpha = 1;
      c.drawImage(paper, 0, 0);
      c.fillStyle = INK;
      for (const s of STAIN) {                            // ink that stays on the paper, soaking away
        const a = t - s.t0; if (a < 0 || a > s.life) continue;
        const k = a / s.life, grow = easeOut(a / 0.12);
        c.globalAlpha = 0.9 * (1 - smooth((k - 0.2) / 0.8));
        if (s.streak) stroke(s.x - s.rx * grow * s.lean, s.y - s.tilt, s.x, s.y + s.bow, s.x + s.rx * grow * (2 - s.lean), s.y + s.tilt, 0, u => s.ry * Math.pow(Math.sin(Math.PI * u), 0.6) + 0.4);
        else { c.beginPath(); c.ellipse(s.x, s.y, s.rx * grow, s.ry * grow, 0, 0, TAU); c.fill(); }
      }
      c.globalAlpha = 1;
      const g = pose(t);
      if (g.vis) {
        const m = solve(g);
        // shadows: a wash under each of them, tighter and darker near the ground
        const wash = (x, y, rx, ry, al) => {
          c.save(); c.translate(x, y); c.scale(1, ry / rx);
          const gr = c.createRadialGradient(0, 0, 0, 0, 0, rx), k = `${B.ink[0]},${B.ink[1]},${B.ink[2]}`;
          gr.addColorStop(0, `rgba(${k},${al})`); gr.addColorStop(0.55, `rgba(${k},${al * 0.5})`); gr.addColorStop(1, `rgba(${k},0)`);
          c.fillStyle = gr; c.beginPath(); c.arc(0, 0, rx, 0, TAU); c.fill(); c.restore();
        };
        const up = clamp((GY - Math.max(m.farToe[1], m.nearToe[1])) / 120, 0, 1), wd = lerp(0.45, 1, Math.abs(g.face));
        wash(lerp((m.farToe[0] + m.nearToe[0]) / 2, g.xc, 0.5), GY + 16, lerp(250, 170, up) * wd, lerp(30, 20, up), lerp(0.42, 0.2, up));
        const gup = clamp((GYG - m.girlFoot[1]) / 120, 0, 1);
        wash(lerp(m.girlFoot[0], m.grip[0], 0.3), GYG + 10, lerp(120, 80, gup), lerp(15, 10, gup), lerp(0.36, 0.16, gup));
        for (const s of SPR) if (s.back) sprite(s, t);
        piece('far', m.far); piece('body', m.body); piece('shin', m.shin); piece('thigh', m.thigh);
        piece('uarm', m.uarm);
        const G = girl(t, g, m);
        piece('gleg2', G.legs[1]); piece('gleg', G.legs[0]); piece('gbody', m.girl); piece('ghead', G.head); piece('gskirt', G.skirt);
        piece('gtailL', G.tailL); piece('gtailR', G.tailR); piece('garm', G.arm);
        piece('farm', m.farm);
        ident();
      } else for (const s of SPR) if (s.back) sprite(s, t);
      for (const s of SPR) if (!s.back) sprite(s, t);
      // ink in the air
      c.fillStyle = INK;
      for (const f of FOAM) {                             // foam: wells up round the foot and sinks back
        const a = t - f.t0; if (a < 0 || a > f.life) continue;
        const k = a / f.life, s = easeOut(a / 0.07) * (1 - smooth((k - 0.3) / 0.7)), r = f.r * s;
        const x = f.x + f.drift * easeOut(k), y = f.y - f.rise * Math.sin(Math.PI * Math.min(1, k * 1.15)) - r * 0.5;
        c.beginPath(); c.ellipse(x, y, r * 1.15, r * 0.8, 0, 0, TAU);
        for (const l of f.lobes) { c.moveTo(x + l[0] * r + l[2] * r, y + l[1] * r); c.arc(x + l[0] * r, y + l[1] * r, l[2] * r, 0, TAU); }
        c.fill();
        if (f.fleck && r > 7) { c.fillStyle = TAN; c.beginPath(); c.ellipse(x + Math.cos(f.fa) * r * 0.35, y - Math.abs(Math.sin(f.fa)) * r * 0.35, r * 0.34, r * 0.2, f.fa, 0, TAU); c.fill(); c.fillStyle = INK; }
      }
      for (const f of BLADE) {                            // blades: shoot out low, thin, let go and run into their tips
        const a = t - f.t0; if (a < 0 || a > f.dur) continue;
        const k = a / f.dur, len = f.len * (1 - Math.exp(-a / 0.05)), u0 = 0.97 * smooth((k - 0.3) / 0.6);
        const ca = Math.cos(f.a) * f.dir, sa = -Math.sin(f.a), sag = 420 * a * a;
        const tx = f.x + ca * len, ty = Math.min(f.y + sa * len + sag, f.y + 4);
        const cx = f.x + ca * len * 0.5 + sa * f.bend * len * f.dir, cy = f.y + sa * len * 0.5 - Math.abs(ca) * f.bend * len;
        const W = f.w * (1 - 0.6 * k) * (1 - smooth((k - 0.7) / 0.3));
        stroke(f.x, f.y, cx, cy, tx, ty, u0, (u, s) => W * 0.5 * Math.pow(1 - u, 0.7) * Math.min(1, 0.3 + s * 4) + 0.6 * (1 - u));
        if (f.knob) { c.beginPath(); c.arc(tx, ty, f.knob * (0.45 + 0.7 * k) * (1 - smooth((k - 0.75) / 0.25)), 0, TAU); c.fill(); }
      }
      for (const p of PART) {
        const a = t - p.t0; if (a < 0 || a > p.life) continue;
        const e = (1 - Math.exp(-p.drag * a)) / p.drag, x = p.x0 + p.vx * e, y = p.y0 + p.vy * e + 0.5 * p.g * a * a;
        const fall = p.vy * Math.exp(-p.drag * a) + p.g * a;             // a falling drop is short: no needles of rain
        const b = Math.max(0, a - p.tail * (1 - 0.7 * a / p.life) * lerp(1, 0.2, sat(fall / 450))), eb = (1 - Math.exp(-p.drag * b)) / p.drag;
        const r = p.r * (0.5 + 0.5 * easeOut(a / 0.08)) * (1 - 0.2 * a / p.life);
        if (p.spr >= 0) {                                 // the big ones are the picture's own drops
          const q = B.drops['d0' + p.spr], k = 2.3 * r / Math.max(q[2], q[3]);
          setT(chain(Tr(x, y), Ro(p.rot + a * 3), Sc(k, k), Tr(-q[2] / 2, -q[3] / 2)));
          c.drawImage(drops, q[0], q[1], q[2], q[3], 0, 0, q[2], q[3]); ident();
        } else comet(x, y, p.x0 + p.vx * eb, p.y0 + p.vy * eb + 0.5 * p.g * b * b, r);
      }
      // present
      gl.viewport(0, 0, view.width, view.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, stage);
      const va = view.width / view.height, sa = SW / SH;
      if (va > sa) gl.uniform4f(uCrop, 0, (1 - sa / va) / 2, 1, sa / va); else gl.uniform4f(uCrop, (1 - va / sa) / 2, 0, va / sa, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function resize() { view.width = innerWidth; view.height = innerHeight; view.style.width = innerWidth + 'px'; view.style.height = innerHeight + 'px'; }
    addEventListener('resize', () => { resize(); if (frozen !== null) draw(frozen); });
    resize();
    function frame() {
      const now = frozen !== null ? frozen : performance.now() / 1000;
      draw(((now % L) + L) % L);
      if (frozen === null) requestAnimationFrame(frame);
    }
    window.Skip.at = t => draw(((t % L) + L) % L);
    requestAnimationFrame(frame);
  }
  window.Skip = { run };
})();
