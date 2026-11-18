// Runner for Under the Wave. No build step, no dependencies.  index.html calls Wave.run(opts).
//
// The print is a round medallion on flat slate. Everything is drawn by one fragment shader in source
// pixels (the 3840x2160 picture; still.png is its 1024x1024 crop at 1420,566):
//   - the sea: the still under a small smooth warp (heave, and the great wave rising about the peak of
//     the swell in front of it);
//   - the crest: the part of the great wave above 30 deg (polar about the hollow's centre) is twirled
//     about the hollow, so it leans back, stands up and curls over; a scalloped front eats it from the
//     tip when it breaks and lets it grow back from the stump;
//   - foam where it lands: the crest's own claws, copied, rising out of the water; and spray dots;
//   - the schooner: line work drawn once on a 2D canvas in the print's inks, moved as a sprite. It
//     sails between the far sea (Fuji) and everything nearer, so the swell hides it as it comes in.
// Time: t = now % L, or ?t=<seconds> to freeze.  ?view=x,y,px looks closer (source point, source px per px).  ?mode=desktop / ?mode=mobile force a 16:9 / 9:20 box.
//
// opts: { L, breakout, frame: portrait => ({ disc, ax, ay }) }
//   breakout  false: the circle is the stage, everything is clipped to it
//             true:  the crest rears up past the edge, foam and spray cross it, and the ship comes
//                    in from the left of the screen over the slate, and leaves the same way
//   frame     disc = diameter of the medallion as a share of the shorter screen side;
//             ax, ay = where its centre sits on the screen (0..1)
(function () {
  const qs = new URLSearchParams(location.search);
  const mode = qs.get('mode');
  const frozen = qs.has('t') ? parseFloat(qs.get('t')) : null;
  const TAU = Math.PI * 2;
  const DISC = [1921.5, 1077.4], DISC_R = 395.4;

  // ---------------------------------------------------------------------------------- the schooner
  // Local units are source pixels, origin on the waterline amidships, bow to the left, y down.
  const SHIP_PX = 4, SHIP_BOX = 256, SHIP_OX = 128, SHIP_OY = 150;
  const PALE = '#85a7bf', LIGHT = '#9dbdd2', MID = '#6081a9', SLATE = '#2e3440';
  function drawShip() {
    const c = document.createElement('canvas');
    c.width = c.height = SHIP_BOX * SHIP_PX;
    const g = c.getContext('2d');
    g.scale(SHIP_PX, SHIP_PX); g.translate(SHIP_OX, SHIP_OY);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = pts => { g.beginPath(); pts.forEach((p, i) => {
      if (i === 0) g.moveTo(p[0], p[1]); else if (p.length === 2) g.lineTo(p[0], p[1]); else g.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    }); };
    const line = (pts, w, col) => { path(pts); g.lineWidth = w; g.strokeStyle = col; g.stroke(); };
    const shape = (pts, fill, w = 1.5, col = SLATE) => { path(pts); g.closePath(); g.fillStyle = fill; g.fill(); if (w) { g.lineWidth = w; g.strokeStyle = col; g.stroke(); } };
    // a sail: filled, outlined, with seams running parallel to the leech (from the foot up)
    const sail = (pts, seams, a, b) => {
      shape(pts, PALE, 1.5);
      g.save(); path(pts); g.closePath(); g.clip();
      for (let i = 1; i <= seams; i++) {
        const o = i / (seams + 1);
        line([[a[0] + (a[2] - a[0]) * o, a[1] + (a[3] - a[1]) * o], [b[0] + (b[2] - b[0]) * o, b[1] + (b[3] - b[1]) * o]], 0.8, 'rgba(46,52,64,0.75)');
      }
      g.restore();
    };
    // spars behind the sails
    line([[-20, -10], [-20, -91]], 2.2, LIGHT);                    // foremast
    line([[14, -10], [14, -106]], 2.2, LIGHT);                     // mainmast
    line([[-54, -16], [-84, -24]], 2.2, LIGHT);                    // bowsprit
    line([[-84, -24], [-50.5, -6]], 0.8, PALE);                    // bobstay
    line([[14, -104], [-20, -89]], 0.8, PALE);                     // triatic stay
    line([[-84, -24], [-20, -89]], 0.8, PALE);                     // jib stay
    line([[14, -98], [52, -15]], 0.7, PALE);                       // topping lift
    for (const [mx, top] of [[-20, -62], [14, -70]]) for (const dx of [5, 9]) line([[mx, top], [mx + dx, -11]], 0.6, PALE);   // shrouds
    // headsails
    sail([[-82, -24], [-22, -86], [-34, -52, -31, -27], [-56, -22, -82, -24]], 3, [-82, -24, -31, -27], [-22, -86, -31, -27]);
    sail([[-55, -17.5], [-22, -62], [-29, -38, -25, -22], [-40, -17, -55, -17.5]], 2, [-55, -17.5, -25, -22], [-22, -62, -25, -22]);
    // gaff foresail and its topsail
    sail([[-18, -21], [-18, -63], [4, -81], [10, -50, 9, -23], [-4, -20, -18, -21]], 4, [-18, -21, 9, -23], [-18, -63, 4, -81]);
    sail([[-18, -66], [-18, -89], [3, -83.5]], 1, [-18, -66, 3, -83.5], [-18, -89, 3, -83.5]);
    // gaff mainsail and its topsail
    sail([[16, -21], [16, -71], [42, -95], [53, -58, 51, -24], [34, -20, 16, -21]], 5, [16, -21, 51, -24], [16, -71, 42, -95]);
    sail([[16, -74], [16, -104], [41, -97.5]], 2, [16, -74, 41, -97.5], [16, -104, 41, -97.5]);
    // gaffs and booms over the sails
    line([[-18, -63.5], [5, -82]], 1.6, LIGHT); line([[16, -71.5], [43, -96]], 1.6, LIGHT);
    line([[-18, -20.5], [10, -22.5]], 1.6, LIGHT); line([[16, -20.5], [53, -23.5]], 1.6, LIGHT);
    // reef points
    for (const [x0, y0, x1, y1, n] of [[-16, -34, 9, -36, 6], [18, -36, 51, -39, 8]])
      for (let i = 0; i < n; i++) { const o = (i + 0.5) / n, x = x0 + (x1 - x0) * o, y = y0 + (y1 - y0) * o; line([[x, y], [x + 0.4, y + 2.6]], 0.8, 'rgba(46,52,64,0.8)'); }
    // pennant
    shape([[14, -106], [27, -103.5], [14, -101]], MID, 0);
    // hull: underbody first (shows only when she is over), then topsides
    const sheer = [[-57, -16.5], [-10, -6.5, 49, -13], [56, -13.5]];
    shape([[-49, -1], [58, -1], [50, 1, 46, 6], [38, 13, 20, 13], [-28, 13], [-42, 12, -49, -1]], MID, 1.4);
    line([[-44, 5], [-20, 8, 44, 6]], 0.8, 'rgba(46,52,64,0.7)');
    shape([...sheer, [53, -6, 47, 0.5], [-47, 0.5], [-49, -6, -57, -16.5]], PALE, 1.6);
    line([[-52, -11.5], [-10, -2, 51, -8.5]], 0.9, 'rgba(46,52,64,0.85)');
    line([[-49.5, -6.5], [-10, 1.5, 49, -4]], 0.8, 'rgba(46,52,64,0.6)');
    line(sheer, 1.4, LIGHT);
    // deckhouse and wheel box
    shape([[-6, -8.5], [-6, -13], [7, -13.6], [7, -9]], LIGHT, 1.1);
    shape([[30, -10.6], [30, -14.4], [37, -14.9], [37, -11.2]], LIGHT, 1.1);
    return c;
  }

  // ---------------------------------------------------------------------------------- the timeline
  // keys: [time, value, ease] sorted by time; the curve wraps around L. ease shapes the segment that
  // ENDS at that key: 's' smooth (default), 'in' accelerating, 'out' decelerating, 'lin'.
  function kf(keys, t, L) {
    const n = keys.length;
    let i = 0; while (i < n && keys[i][0] <= t) i++;
    const a = keys[(i - 1 + n) % n], b = keys[i % n];
    let ta = a[0], tb = b[0];
    if (i === 0) ta -= L; if (i === n) tb += L;
    let u = tb > ta ? (t - ta) / (tb - ta) : 0;
    const e = b[2] || 's';
    u = e === 'lin' ? u : e === 'in' ? u * u * u : e === 'out' ? 1 - Math.pow(1 - u, 3) : u * u * (3 - 2 * u);
    return a[1] + (b[1] - a[1]) * u;
  }
  const X0 = 1968.5, HIT = 8.45;                                   // the crest lands on the ship
  function timeline(t, o) {
    const L = o.L, s = {};
    // the wave: twirl of the crest (rad, + = curling over), pull toward the hollow, rise, erosion front
    const TH = o.breakout ? 1.3 : 1.15;
    s.th = kf([[0, -0.17], [4.6, -0.10], [7.1, 0.07], [8.55, TH, 'in'], [10.2, TH - 0.1], [13.6, -0.30], [21, -0.25]], t, L);
    s.kap = kf([[7.2, 0], [8.6, o.breakout ? 0 : 0.2, 'in'], [10.2, o.breakout ? 0 : 0.2], [13.6, 0], [20, 0]], t, L);
    s.drop = kf([[7.3, 0], [8.6, 125, 'in'], [10.2, 270, 'lin'], [13.6, 0], [20, 0]], t, L);
    s.hs = kf([[0, 0.93], [6.9, o.breakout ? 1.085 : 1.035], [7.7, o.breakout ? 1.08 : 1.03], [9.6, 0.86], [13, 0.80], [20, 0.855]], t, L);
    s.cut = kf([[7.9, 1.25], [10.0, 0.30, 'lin'], [13.6, 0.27], [25.5, 1.25, 'lin']], t, L);
    s.burst = t - HIT;                                 // seconds since the hit (foam and spray)

    // the ship: [x, y, tilt, cos(roll), facing]  (facing 1 = bow to the left, as drawn; -1 = to the right)
    const yw = x => 1253 - (Math.max(x, 1560) - 1560) * 0.033;
    const ship = tt => {
      let x, y, a;
      if (tt < HIT) x = X0 - 30 * tt;                // sailing in at 30 px/s from behind the swell
      else if (tt < 17.5) x = X0 - 30 * HIT - 30 * (1 - Math.exp(-(tt - HIT) * 0.9)) - 0.6 * (tt - HIT);
      else {
        const x0 = X0 - 30 * HIT - 30 * (1 - Math.exp(-(17.5 - HIT) * 0.9)) - 0.6 * (17.5 - HIT), u = tt - 17.5;
        const v0 = 4, v1 = o.breakout ? 92 : 26, T = o.breakout ? 5 : 3.5;       // gathers way
        x = x0 - (u < T ? v0 * u + (v1 - v0) * u * u * u / (T * T) * (1 - u / (2 * T)) : v0 * T + (v1 - v0) * T / 2 + v1 * (u - T));
      }
      // She is drawn side-on, so going over is a roll about her length: her height scales by cos(roll)
      // (sails fold down onto the water, then the keel comes up). tilt (+ = bow down) is the pitching.
      const pitch = 0.045 * Math.sin(TAU * tt / 4) + 0.02 * Math.sin(TAU * tt / 2.8 + 1);
      const k = tt - HIT, RIGHT = 6.2, RLEN = 2.4;
      const bob = q => 0.34 * Math.exp(-q * 0.2) * Math.sin(TAU * q / 2.1 + 0.5) * Math.min(1, q / 0.8);
      const over = q => 2.62 * (1 - Math.exp(-q * 3.4)) + bob(q);
      let roll = 0;
      if (k < -0.7) a = pitch;
      else if (k < 0) a = pitch + 0.2 * Math.pow((k + 0.7) / 0.7, 2);            // the stern lifts
      else if (k < RIGHT) { roll = over(k); a = 0.2 * Math.exp(-k * 1.5) + 0.09 * Math.sin(TAU * k / 1.7) * Math.min(1, k); }
      else if (k < RIGHT + RLEN) {
        const u = (k - RIGHT) / RLEN, e = u * u * u * (u * (6 * u - 15) + 10);
        roll = over(RIGHT) * (1 - e); a = 0.09 * Math.sin(TAU * k / 1.7) * (1 - e) - 0.10 * Math.sin(Math.PI * u);
      } else { const d = k - RIGHT - RLEN; a = pitch * (1 - Math.exp(-d)) - 0.17 * Math.exp(-d * 0.8) * Math.sin(TAU * d / 1.9); }
      const c = Math.cos(roll);
      y = yw(x) + 1.5 + 1.6 * Math.sin(TAU * tt / 4 + 1.2) - 9 * Math.max(0, -c);
      return [x, y, a, c];
    };
    // Breakout: she comes in from the left of the screen, bow to the right, runs over the slate, slows
    // as she enters the circle and meets the crest in the trough. She comes back up facing the way she
    // came (the turn happens while she is edge-on, mid-roll) and sails out over the slate again. The
    // wrap of the loop falls while she is off the screen.
    const XH = 1680, VIN = 158, VOUT = 129, RIGHT_B = 4.8, RLEN = 2.4;
    const shipOut = t0 => {
      const tt = t0 < 27.2 ? t0 : t0 - L, k = tt - HIT;
      const pitch = 0.045 * Math.sin(TAU * tt / 4) + 0.02 * Math.sin(TAU * tt / 2.8 + 1);
      const bob = q => 0.34 * Math.exp(-q * 0.2) * Math.sin(TAU * q / 2.1 + 0.5) * Math.min(1, q / 0.8);
      const over = q => 2.62 * (1 - Math.exp(-q * 3.4)) + bob(q);
      const drift = q => XH - 26 * (1 - Math.exp(-q * 0.9)) - 0.6 * q;
      let x, a, roll = 0, face = 1;
      if (k < 0) {                                     // in: full sail, then easing off over the last 3 s
        const q = -k;
        x = XH - (q < 3 ? 32 * q + (VIN - 32) * q * q / 6 : 96 + (VIN - 32) * 1.5 + VIN * (q - 3));
        a = pitch - (q < 0.7 ? 0.2 * Math.pow((0.7 - q) / 0.7, 2) : 0);            // the bow lifts to the wave
        face = -1;
      } else if (k < RIGHT_B) { x = drift(k); roll = over(k); face = -1; a = 0.2 * Math.exp(-k * 1.5) + 0.09 * Math.sin(TAU * k / 1.7) * Math.min(1, k); }
      else if (k < RIGHT_B + RLEN) {
        const u = (k - RIGHT_B) / RLEN, e = u * u * u * (u * (6 * u - 15) + 10);
        x = drift(k); roll = over(RIGHT_B) * (1 - e); face = roll > Math.PI / 2 ? -1 : 1;
        a = 0.09 * Math.sin(TAU * k / 1.7) * (1 - e) - 0.10 * Math.sin(Math.PI * u);
      } else {
        const d = k - RIGHT_B - RLEN, u = Math.max(0, d - 0.25), T = 3;
        x = drift(Math.min(k, RIGHT_B + RLEN + 0.25)) - (u < T ? VOUT * u * u / (2 * T) : VOUT * T / 2 + VOUT * (u - T));
        a = pitch * (1 - Math.exp(-d)) - 0.17 * Math.exp(-d * 0.8) * Math.sin(TAU * d / 1.9);
      }
      const c = Math.cos(roll);
      const y = yw(x) + 1.5 + 1.6 * Math.sin(TAU * tt / 4 + 1.2) - 9 * Math.max(0, -c);
      return [t0 >= 27 && t0 < 27.2 ? -1e6 : x, y, a * face, c, face];
    };
    s.ship = o.breakout ? shipOut(t) : [...ship(t), 1];
    if (!o.breakout && s.ship[0] < 1430) s.ship[0] = -1e6;
    s.shed = t - (HIT + (o.breakout ? RIGHT_B : 6.2) + 1.5);    // water runs off her as she comes up
    return s;
  }

  // ---------------------------------------------------------------------------------- the shader
  const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImg, uSil, uShip;
uniform vec2 uRes, uC;
uniform float uPx;                       // source pixels per screen pixel
uniform float uT, uL, uTh, uKap, uDrop, uHs, uCut, uBurst, uShed, uBreak;
uniform vec4 uBoat;                     // x, y, tilt, cos(roll)
uniform float uFace;                     // 1: bow to the left, -1: to the right
out vec4 outColor;
const float TAU = 6.28318530718, PI = 3.14159265359;
const vec2 O = vec2(1420.0, 566.0);      // still.png's corner in the source
const vec3 SLATE = vec3(46.0, 52.0, 64.0)/255.0;
const vec3 PALE = vec3(133.0, 167.0, 191.0)/255.0;
const vec2 DISC = vec2(${DISC[0]}, ${DISC[1]});
const float DISC_R = ${DISC_R};
const vec2 HOLLOW = vec2(1810.0, 1080.0);   // the twirl's centre
const vec2 PEAK = vec2(1990.0, 1085.0);     // the swell in front: the great wave rises about it
const float G0 = 0.2618, G1 = 1.8326, GEND = 3.23;   // crest weight 0 at 15 deg .. 1 at 105 deg; nothing past 185
const float SHIP_S = 1.1;
const vec2 HITP = vec2(1705.0, 1248.0);

float hash1(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec2 hash2(vec2 p){ float n = hash1(p); return vec2(n, hash1(p+n+17.1)); }
float lod(){ return max(log2(uPx), 0.0); }
vec3 still(vec2 q){ return textureLod(uImg, (q - O)/1024.0, lod()).rgb; }
float sil(vec2 q){
  vec2 uv = (q - O)/1024.0;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return smoothstep(0.25, 0.75, textureLod(uSil, uv, lod()).r);
}
float disc(vec2 p){ return 1.0 - smoothstep(-0.7*uPx, 0.7*uPx, length(p - DISC) - DISC_R - 0.5); }
float waterline(float x){ return 1253.0 - (max(x, 1560.0) - 1560.0)*0.033; }   // level out on the slate
float cyc(float n, float ph){ return sin(TAU*(n*uT/uL + ph)); }

// where the sea at screen point p comes from in the still: heave, and the rise of the great wave
vec2 sea(vec2 p){
  float wB = smoothstep(1260.0, 1090.0, p.y)*smoothstep(2330.0, 2060.0, p.x);
  vec2 s = vec2(1.0 + (uHs - 1.0)*0.55*wB, 1.0 + (uHs - 1.0)*wB);
  vec2 q = PEAK + (p - PEAK)/s;
  float edge = smoothstep(0.0, 90.0, DISC_R - length(p - DISC));
  float far = 1.0 - (1.0 - smoothstep(1745.0, 1830.0, p.x))*(1.0 - smoothstep(1250.0, 1300.0, p.y));
  float w = edge*far;
  q.y += w*(4.5*sin(TAU*(p.x/620.0 + 3.0*uT/uL)) + 2.2*sin(TAU*(p.x/330.0 + p.y/900.0 + 5.0*uT/uL) + 1.7));
  q.x += w*(2.6*sin(TAU*(p.y/540.0 + p.x/1500.0 + 4.0*uT/uL) + 0.6));
  return q;
}
float gw(float a){ return smoothstep(G0, G1, a); }
float ang(vec2 v){ float a = atan(-v.y, v.x); return a < -0.5*PI ? a + TAU : a; }
// the scalloped front that eats the crest: 0 at the foot of the great wave, ~1 at the tip
float erosion(vec2 q){
  vec2 n = vec2(-0.8, -0.6), d = q - vec2(1960.0, 1010.0);
  float along = dot(d, n), perp = max(dot(d, vec2(n.y, -n.x)), 0.0);
  vec2 g = q/26.0, c = floor(g), f = fract(g);
  float m = 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    m = min(m, length(o + 0.15 + 0.7*hash2(c + o) - f));
  }
  return (along + perp*perp/900.0)/300.0 - 0.085*(1.0 - smoothstep(0.0, 0.62, m));
}
// the crest layer: color and coverage at screen point p
vec4 crest(vec2 p){
  // forward: a point at angle a about the hollow goes to a + th*g(a), is pulled in by kap*g and
  // dropped by g*g*drop. Solve for the angle it came from (the map is monotonic along the wave).
  vec2 dn = vec2(-0.25, 1.0)*uDrop;
  float ap = ang(p - HOLLOW);
  if (ap < G0 - 0.02 || ap > 4.45) return vec4(0.0);
  float lo = G0 - 0.02, hi = GEND;
  { float g = gw(hi); if (ang(p - g*g*dn - HOLLOW) > hi + uTh*g) return vec4(0.0); }
  for (int i = 0; i < 16; i++) {
    float m = 0.5*(lo + hi), g = gw(m);
    if (m + uTh*g < ang(p - g*g*dn - HOLLOW)) lo = m; else hi = m;
  }
  float as = 0.5*(lo + hi);
  if (as > GEND - 0.01) return vec4(0.0);
  float g = gw(as);
  float rs = length(p - g*g*dn - HOLLOW)/(1.0 - uKap*g);
  vec2 q = sea(HOLLOW + rs*vec2(cos(as), -sin(as)));
  float al = sil(q);
  if (al <= 0.0) return vec4(0.0);
  float e = erosion(q);
  float aa = 0.012;
  al *= 1.0 - smoothstep(uCut - aa, uCut + aa, e);
  vec3 col = still(q);
  col = mix(col, PALE, smoothstep(uCut - 0.085, uCut - 0.085 + 2.0*aa, e)*step(uCut, 1.2));
  return vec4(col, al);
}
// a tuft of foam: the crest's own claws, turned to stand up out of the water at c
vec4 tuft(vec2 p, vec2 c, float s, float rot, float flip){
  if (s <= 0.01) return vec4(0.0);
  vec2 d = (p - c)/s; d.x *= flip;
  if (dot(d, d) > 100.0*100.0) return vec4(0.0);
  float cr = cos(rot), sr = sin(rot);
  d = vec2(cr*d.x - sr*d.y, sr*d.x + cr*d.y);
  // screen down -> toward the root of the claws in the still (up and to the right)
  vec2 q = vec2(1742.0, 905.0) + d.x*vec2(0.5, 0.866) + d.y*vec2(0.866, -0.5);
  float al = sil(q)*(1.0 - smoothstep(88.0, 96.0, length(d)));
  al *= step(1.72, ang(q - HOLLOW));                    // claws only, not the dark of the wave
  return vec4(still(q), al);
}
vec4 ship(vec2 p, vec4 S){
  vec2 v = p - S.xy;
  if (dot(v, v) > 170.0*170.0 || abs(S.w) < 0.02) return vec4(0.0);
  float c = cos(S.z), s = sin(S.z);
  vec2 l = vec2(v.x*c - v.y*s, v.x*s + v.y*c)/SHIP_S;
  l.y /= S.w;                                        // the roll
  l.x *= uFace;
  vec2 uv = (l + vec2(${SHIP_OX}.0, ${SHIP_OY}.0))/${SHIP_BOX}.0;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return textureLod(uShip, uv, log2(max(uPx*${SHIP_PX}.0/SHIP_S, 1.0)));      // premultiplied
}
// a line of foam along the hull where she cuts the water, and a short wake astern
float wake(vec2 p, vec4 S){
  float up = smoothstep(0.5, 0.95, S.w);
  float x = uFace*(p.x - S.x)/SHIP_S, y = p.y - waterline(p.x);
  if (up <= 0.0 || abs(x) > 160.0 || abs(y) > 8.0) return 0.0;
  float body = smoothstep(-66.0, -50.0, x)*(1.0 - smoothstep(60.0, 150.0, x));
  float h = 1.7*body + 3.2*exp(-pow((x + 50.0)/9.0, 2.0));
  float dash = x > 62.0 ? step(0.0, sin(x*0.21 - uT*3.0)) : 1.0;
  float top = -h + 1.1*sin(x*0.33 + TAU*8.0*uT/uL);
  return up*dash*body*smoothstep(top - 0.6*uPx, top + 0.6*uPx, y)*(1.0 - smoothstep(0.8 - 0.6*uPx, 0.8 + 0.6*uPx, y));
}
// spray dots thrown up from c, k seconds ago
float spray(vec2 p, vec2 c0, float k, float seed, int n, float speed, float spread){
  float sp = 0.0;
  for (int i = 0; i < n; i++) {
    vec2 h = hash2(vec2(float(i), seed)), h2 = hash2(vec2(float(i), seed + 7.5));
    float an = mix(0.35, 2.75, h.x), v = speed*mix(0.33, 1.0, h.y*h.y + 0.15*h2.x);
    float life = mix(0.9, 2.4, h2.y), kk = k - 0.25*h2.x;
    if (kk < 0.0 || kk > life) continue;
    vec2 c = c0 + vec2(spread*(h2.x - 0.5), 0.0) + v*kk*vec2(cos(an), -sin(an)) + vec2(0.0, 0.5*430.0*kk*kk);
    float rad = mix(1.6, 4.6, h2.y*h.x)*(1.0 - smoothstep(0.6, 1.0, kk/life));
    sp = max(sp, 1.0 - smoothstep(rad - 0.6*uPx, rad + 0.6*uPx, length(p - c)));
  }
  return sp;
}
vec3 over(vec3 dst, vec4 src){ return mix(dst, src.rgb, src.a); }

void main(){
  vec2 d = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - 0.5*uRes;
  vec2 p = uC + d*uPx;
  float inDisc = disc(p);
  float stage = mix(inDisc, 1.0, uBreak);            // what may leave the circle
  vec3 col = SLATE;

  // the sea, without the crest
  vec2 q = sea(p);
  float a0 = ang(p - HOLLOW);
  float seaA = sil(q)*inDisc*(1.0 - step(G0, a0)*step(a0, GEND));
  vec3 seaC = still(q);
  float farZone = (1.0 - step(1745.0, q.x))*(1.0 - smoothstep(-0.5, 0.5, q.y - waterline(q.x)));
  col = mix(col, seaC, seaA*farZone);                // Fuji and the far water: behind the ship

  // things floating at the waterline: hidden below it (left of the swell; the swell hides the rest)
  float afloat = stage*(p.x < 1745.0 ? 1.0 - smoothstep(-0.6*uPx, 0.6*uPx, p.y - waterline(p.x) - 0.5) : 1.0);
  float k = uBurst;
  if (k > 0.0 && k < 9.5 && afloat > 0.0) {
    float grow = 1.0 - exp(-k*5.0), fade = 1.0 - smoothstep(2.0, 9.0, k);
    for (int i = 0; i < 4; i++) {
      float fi = float(i), h = hash1(vec2(fi, 3.1));
      vec2 c = HITP + vec2(-118.0 + 76.0*fi + 14.0*h, 4.0 + 10.0*h + 46.0*(1.0 - fade) - 14.0*grow*exp(-k*0.9) + 3.0*sin(TAU*k/2.3 + fi));
      float s = (0.66 + 0.2*h)*grow*(0.35 + 0.65*fade);
      col = over(col, tuft(p, c, s, -0.5 + 0.33*fi + 0.1*sin(TAU*k/3.1 + fi), i == 1 || i == 2 ? -1.0 : 1.0)*vec4(1.0, 1.0, 1.0, afloat));
    }
  }
  vec4 sA = ship(p, uBoat);
  col = col*(1.0 - sA.a*afloat) + sA.rgb*afloat;
  col = mix(col, PALE, stage*wake(p, uBoat));
  if (k > 0.0 && k < 9.5 && afloat > 0.0) {
    float grow = 1.0 - exp(-k*4.0), fade = 1.0 - smoothstep(1.5, 8.0, k);
    for (int i = 0; i < 3; i++) {
      float fi = float(i), h = hash1(vec2(fi, 8.7));
      vec2 c = HITP + vec2(-84.0 + 84.0*fi + 12.0*h, 14.0 + 8.0*h + 34.0*(1.0 - fade) - 8.0*grow*exp(-k*0.9) + 2.5*sin(TAU*k/1.9 + 2.0*fi));
      float s = (0.46 + 0.14*h)*grow*(0.3 + 0.7*fade);
      col = over(col, tuft(p, c, s, 0.45 - 0.4*fi + 0.1*sin(TAU*k/2.7 + fi), i == 1 ? 1.0 : -1.0)*vec4(1.0, 1.0, 1.0, afloat));
    }
  }

  col = mix(col, seaC, seaA*(1.0 - farZone));        // the near sea, over the ship
  vec4 cr = crest(p);
  // how far past the edge the crest may reach: nothing along the wave's back, more toward the tip
  float reach = uBreak*500.0*smoothstep(0.6, 1.4, ang(p - HOLLOW));
  col = mix(col, cr.rgb, cr.a*(1.0 - smoothstep(-0.7*uPx, 0.7*uPx, length(p - DISC) - DISC_R - 0.5 - reach)));

  // spray: where the crest lands, and a little as she comes back up
  float sp = 0.0;
  if (k > 0.0 && k < 2.7) sp = spray(p, HITP + vec2(-10.0, -8.0), k, 1.7, 34, 330.0, 60.0);
  if (uShed > 0.0 && uShed < 2.7) sp = max(sp, spray(p, uBoat.xy + vec2(0.0, -14.0), uShed, 4.3, 14, 150.0, 90.0));
  col = mix(col, PALE, sp*stage);
  outColor = vec4(col, 1.0);
}`;

  function run(o) {
    document.documentElement.style.cssText = 'margin:0;height:100%;background:#2e3440;overflow:hidden';
    document.body.style.cssText = 'margin:0;height:100%;background:#2e3440;overflow:hidden';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;display:block';
    document.body.appendChild(canvas);
    if (qs.has('ship')) {                               // ?ship : look at the drawing on its own
      const s = drawShip(); s.style.cssText = 'position:fixed;left:0;top:0;background:#2e3440;height:100%';
      document.body.appendChild(s); window.__ready = true; return;
    }
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) { document.body.textContent = 'WebGL2 not available'; return; }
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'a');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);

    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const tex = (name, unit, source, premult) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premult);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.uniform1i(U(name), unit);
    };
    const load = src => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error('cannot load ' + src)); im.src = src; });

    function layout() {
      let w = innerWidth, h = innerHeight, x = 0, y = 0;
      const box = mode === 'desktop' ? 16 / 9 : mode === 'mobile' ? 9 / 20 : 0;
      if (box) {
        if (w / h > box) { const nw = Math.round(h * box); x = (w - nw) >> 1; w = nw; }
        else { const nh = Math.round(w / box); y = (h - nh) >> 1; h = nh; }
      }
      canvas.style.left = x + 'px'; canvas.style.top = y + 'px';
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      let s = Math.min(window.devicePixelRatio || 1, 2);
      const cap = 2560 * 1440;
      if (w * h * s * s > cap) s = Math.sqrt(cap / (w * h));
      canvas.width = Math.max(1, Math.round(w * s)); canvas.height = Math.max(1, Math.round(h * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      const W = canvas.width, H = canvas.height;
      const f = o.frame(H > W);
      let px = 2 * DISC_R / (f.disc * Math.min(W, H));       // source px per screen px
      let cx = DISC[0] + (0.5 - f.ax) * W * px, cy = DISC[1] + (0.5 - f.ay) * H * px;
      if (qs.has('view')) [cx, cy, px] = qs.get('view').split(',').map(Number);   // ?view=x,y,px : a close look
      gl.uniform2f(U('uRes'), W, H);
      gl.uniform1f(U('uPx'), px);
      gl.uniform2f(U('uC'), cx, cy);
    }
    function draw() {
      const now = frozen !== null ? frozen : performance.now() / 1000;
      const t = ((now % o.L) + o.L) % o.L, s = timeline(t, o);
      gl.uniform1f(U('uT'), t); gl.uniform1f(U('uL'), o.L);
      gl.uniform1f(U('uTh'), s.th); gl.uniform1f(U('uKap'), s.kap); gl.uniform1f(U('uDrop'), s.drop); gl.uniform1f(U('uHs'), s.hs);
      gl.uniform1f(U('uCut'), s.cut); gl.uniform1f(U('uBurst'), s.burst); gl.uniform1f(U('uShed'), s.shed);
      gl.uniform1f(U('uBreak'), o.breakout ? 1 : 0);
      gl.uniform4f(U('uBoat'), ...s.ship.slice(0, 4)); gl.uniform1f(U('uFace'), s.ship[4]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    let raf = 0;
    function frame() { raf = 0; if (document.hidden) return; draw(); if (frozen === null) raf = requestAnimationFrame(frame); }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    Promise.all([load('still.png'), load('sil.png')]).then(([still, sil]) => {
      tex('uImg', 0, still, false); tex('uSil', 1, sil, false); tex('uShip', 2, drawShip(), true);
      layout(); draw(); window.__ready = true; kick();
      addEventListener('resize', () => { layout(); draw(); kick(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    }).catch(e => { console.error(e); document.body.textContent = String(e); });
  }
  window.Wave = { run, timeline };
})();
