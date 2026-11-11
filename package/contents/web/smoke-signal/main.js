// "Smoke Signal" — Gunsmoke's live fluid smoke seen through Signal's failing transmission.
(function () {
  'use strict';
  var canvas = document.getElementById('c');
  var gl = WP.context(canvas);
  if (!gl) return;

  var VW = 256, VH = 144;       // velocity / pressure grid (16 cells per image unit; image = 16 x 9 units)
  var DW = 640, DH = 360;       // dye grid
  var JACOBI = 12;
  var WARMUP_S = 80, STEP = 1 / 15;

  // sim passes use unflipped UVs so texture coords == image uv (y down) in storage
  var SIM_VS = '#version 300 es\nout vec2 vUV;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUV=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
  var HEAD = '#version 300 es\nprecision highp float;\nin vec2 vUV;\nout vec4 o;\n#define AR vec2(16.,9.)\n';

  var FS_ADVECT_VEL = HEAD + `
uniform sampler2D uVel, uDye;
uniform float uDt;
uniform vec4 uWind;   // x = gyre amplitude, y = top draught, z = swirl amplitude
uniform vec4 uPh;     // swirl phases
uniform vec4 uJet;    // xy = muzzle jet velocity, z = strength
void main(){
  vec2 v = texture(uVel, vUV).xy;
  vec2 nv = texture(uVel, vUV - uDt*v/AR).xy;
  vec2 p = vUV*AR;
  // ambient air: slow, divergence-free, drifting left
  // one big slow gyre around the figure (up the right side, left across the top, down the left) plus wandering swirls
  vec2 s1 = sin(3.14159265*vUV), s2 = sin(6.2831853*vUV);
  vec2 wind = uWind.x*3.14159265*vec2(s2.y*s1.x*s1.x/9.0, -s2.x*s1.y*s1.y/16.0)
            + uWind.z*vec2(sin(p.y*0.80 + uPh.x) + 0.5*sin(p.y*1.9 + uPh.z) + 0.6*sin(p.y*3.3 - uPh.y*2.0),
                           0.55*sin(p.x*0.55 + uPh.y) + 0.4*sin(p.x*1.3 + uPh.w) + 0.6*sin(p.x*2.9 + uPh.x*2.0));
  wind.x -= uWind.y*exp(-pow((vUV.y - 0.17)/0.13, 2.0));          // a lazy draught across the top, right to left
  nv += (wind - nv)*(1.0 - exp(-uDt*0.35));
  // buoyancy (up = -y)
  vec4 d = texture(uDye, vUV);
  nv.y -= uDt*0.85*min(d.r, 1.5)*smoothstep(0.10, 0.30, vUV.y);
  // muzzle jet
  vec2 dm = p - vec2(14.78, 2.70);
  nv += (uJet.xy - nv)*exp(-dot(dm,dm)/0.045)*min(1.0, uDt*14.0)*uJet.z;
  float l = length(nv);
  if (l > 8.0) nv *= 8.0/l;
  if (!(l >= 0.0)) nv = vec2(0.);          // NaN guard
  o = vec4(nv, 0., 1.);
}`;

  var FS_CURL = HEAD + `
uniform sampler2D uVel; uniform vec2 uTx;
void main(){
  float L = texture(uVel, vUV - vec2(uTx.x,0.)).y, R = texture(uVel, vUV + vec2(uTx.x,0.)).y;
  float B = texture(uVel, vUV - vec2(0.,uTx.y)).x, T = texture(uVel, vUV + vec2(0.,uTx.y)).x;
  o = vec4(0.5*(R - L - T + B), 0., 0., 1.);
}`;

  var FS_VORT = HEAD + `
uniform sampler2D uVel, uCurl; uniform vec2 uTx; uniform float uDt, uConf;
void main(){
  float L = texture(uCurl, vUV - vec2(uTx.x,0.)).x, R = texture(uCurl, vUV + vec2(uTx.x,0.)).x;
  float B = texture(uCurl, vUV - vec2(0.,uTx.y)).x, T = texture(uCurl, vUV + vec2(0.,uTx.y)).x;
  float C = texture(uCurl, vUV).x;
  vec2 f = 0.5*vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= uConf*C; f.y *= -1.0;
  o = vec4(texture(uVel, vUV).xy + f*uDt, 0., 1.);
}`;

  var FS_DIV = HEAD + `
uniform sampler2D uVel; uniform vec2 uTx;
void main(){
  float L = texture(uVel, vUV - vec2(uTx.x,0.)).x, R = texture(uVel, vUV + vec2(uTx.x,0.)).x;
  float B = texture(uVel, vUV - vec2(0.,uTx.y)).y, T = texture(uVel, vUV + vec2(0.,uTx.y)).y;
  o = vec4(0.5*(R - L + T - B), 0., 0., 1.);
}`;

  var FS_JACOBI = HEAD + `
uniform sampler2D uP, uDiv; uniform vec2 uTx;
float P(vec2 uv){ return (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) ? 0.0 : texture(uP, uv).x; }   // open borders
void main(){
  float s = P(vUV - vec2(uTx.x,0.)) + P(vUV + vec2(uTx.x,0.)) + P(vUV - vec2(0.,uTx.y)) + P(vUV + vec2(0.,uTx.y));
  o = vec4((s - texture(uDiv, vUV).x)*0.25, 0., 0., 1.);
}`;

  var FS_GRAD = HEAD + `
uniform sampler2D uP, uVel; uniform vec2 uTx;
float P(vec2 uv){ return (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) ? 0.0 : texture(uP, uv).x; }
void main(){
  vec2 g = 0.5*vec2(P(vUV + vec2(uTx.x,0.)) - P(vUV - vec2(uTx.x,0.)), P(vUV + vec2(0.,uTx.y)) - P(vUV - vec2(0.,uTx.y)));
  o = vec4(texture(uVel, vUV).xy - g, 0., 1.);
}`;

  var FS_DYE = HEAD + `
uniform sampler2D uVel, uDye;
uniform float uDt;
uniform vec4 uEmit;      // x = muzzle rate, y = splat radius^2, z = decay factor this step
void main(){
  vec2 v = texture(uVel, vUV).xy;
  vec4 d = texture(uDye, vUV - uDt*v/AR);
  d.r *= uEmit.z;
  vec2 p = vUV*AR;
  vec2 dm = p - vec2(14.80, 2.70);
  d.r += uEmit.x*uDt*exp(-dot(dm,dm)/uEmit.y);
  vec2 e = min(vUV, 1.0 - vUV);
  d.r *= smoothstep(0.0, 0.03, e.x)*smoothstep(0.0, 0.03, e.y);     // smoke leaves at the borders
  d = clamp(d, 0.0, 3.0);
  if (!(d.r >= 0.0)) d = vec4(0.);
  o = d;
}`;

  // Composite: Gunsmoke's scene (flat-toned smoke behind the figure, muzzle flash) seen through Signal's
  // failing transmission (slice glitches, RGB split, neon washes, rain, scanlines, grain).
  var FS_COMP = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uBase, uMA, uMB, uDye;   // MA: r=red g=white b=silhouette | MB: r=red glow g=white halo
uniform vec4 uCover;
uniform vec2 uDyeSize;
uniform float uHasSim;
uniform vec4 uShot;     // x = flash size (0 = none), y = shape seed
uniform float uT;
uniform vec4 uG;        // x = glitch intensity, y = seed, z = type, w = micro-twitch seed (0 = none)
uniform vec4 uNeon;     // x = red sign, y = cyan sign, z = collar lettering, w = per-frame grain seed
#define TAU 6.28318530718

float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float h21p(vec2 p){ return h21(mod(p, 256.0)); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21p(i),h21p(i+vec2(1,0)),f.x), mix(h21p(i+vec2(0,1)),h21p(i+vec2(1,1)),f.x), f.y); }

// thin falling streaks; v (cells/s) must keep v*4096 integer
float rain(vec2 p, float n, float cellLen, float v, float so){
  p.x += p.y*0.13;
  float cx = floor(p.x*n);
  float h = h11(cx + so), h2 = h11(cx*1.7 + so + 5.), h3 = h11(cx*2.3 + so + 9.);
  float xo = fract(p.x*n) - (0.2 + 0.6*h2);
  float line = smoothstep(0.075, 0.02, abs(xo));
  float y = fract(p.y/cellLen - uT*(v + floor(h3*4.)*0.25) + h*17.);
  float streak = smoothstep(0.0, 0.13, y)*step(y, 0.13);
  return line*streak*step(0.45, h3)*(0.5 + 0.5*h);
}

vec4 cubic(float v){ vec4 n = vec4(1.,2.,3.,4.) - v; vec4 s = n*n*n; float x = s.x, y = s.y - 4.*s.x, z = s.z - 4.*s.y + 6.*s.x; return vec4(x, y, z, 6. - x - y - z)/6.; }
vec4 bicubic(sampler2D t, vec2 uv, vec2 size){
  vec2 tc = uv*size - 0.5; vec2 f = fract(tc); tc -= f;
  vec4 xc = cubic(f.x), yc = cubic(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (c + vec4(xc.yw, yc.yw)/s)/size.xxyy;
  float sx = s.x/(s.x + s.y), sy = s.z/(s.z + s.w);
  return mix(mix(texture(t, off.yw), texture(t, off.xw), sx), mix(texture(t, off.yz), texture(t, off.xz), sx), sy);
}
float band(float s, float th, float w){ return smoothstep(th - w, th + w, s); }

void main(){
  vec2 uv = vUV*uCover.xy + uCover.zw;
  vec2 guv = uv;
  float G = uG.x, seed = uG.y;
  float chroma = 0.00035 + 0.0011*abs(uv.x - 0.5);
  float tearMix = 0.0;
  float staticLine = 0.0;

  if (G > 0.0) {
    // horizontal slice displacement
    float n = mix(8., 30., h11(seed));
    float bnd = floor(uv.y*n + h11(seed + 3.)*7.);
    float on = step(0.60, h21(vec2(bnd, seed)));
    guv.x += (h21(vec2(bnd, seed + 7.)) - 0.5)*0.15*G*on;
    chroma += 0.0055*G*(0.25 + on);
    // datamosh-like tear: a window of blocks holds one row and smears it vertically
    if (uG.z > 0.45) {
      vec2 c = vec2(0.2 + 0.6*h11(seed + 1.), 0.2 + 0.55*h11(seed + 2.));
      vec2 win = vec2(0.16 + 0.14*h11(seed + 4.), 0.07 + 0.10*h11(seed + 5.));
      vec2 bc = floor(uv*vec2(48., 27.));
      float hb = h21(bc + floor(seed));
      if (abs(uv.x - c.x) < win.x && abs(uv.y - c.y) < win.y && hb > 0.30) {
        float rows = 1.0 + floor(h21(vec2(bc.x, seed))*3.0);
        guv.y = (floor(bc.y/rows)*rows + 0.5)/27. + (uv.y - (bc.y + 0.5)/27.)*0.06;
        guv.x += (h21(vec2(bc.y, seed + 2.)) - 0.5)*0.045;
        tearMix = 1.0;
      }
    }
    // a couple of thin static bars
    float sb = floor(uv.y*270.);
    staticLine = step(0.985, h21(vec2(sb, seed)))*G;
  }
  if (uG.w > 0.0) {
    float y0 = 0.08 + 0.84*h11(uG.w);
    float hgt = 0.006 + 0.018*h11(uG.w + 2.);
    if (abs(uv.y - y0) < hgt) { guv.x += (h11(uG.w + 1.) - 0.5)*0.05; chroma += 0.003; }
  }

  // the artwork and its silhouette, with a horizontal RGB split
  vec2 cx = vec2(chroma, 0.);
  vec3 base = texture(uBase, guv).rgb;
  vec3 ma = texture(uMA, guv).rgb;
  vec3 mb = texture(uMB, guv).rgb;
  float bR = texture(uBase, guv + cx).r, bB = texture(uBase, guv - cx).b;
  float kR = texture(uMA, guv + cx).b,  kB = texture(uMA, guv - cx).b;

  // grey smoke behind the figure: flat tones that stay darker than the jacket
  vec3 sm = vec3(0.0405);
  float smk = 0.0;
  if (uHasSim > 0.5) {
    float s = bicubic(uDye, guv, uDyeSize).r;
    float w = clamp(fwidth(s)*0.7, 1e-5, 0.02 + s*0.5);
    sm = mix(sm, vec3(0.058), band(s, 0.012, w));
    sm = mix(sm, vec3(0.080), band(s, 0.035, w));
    sm = mix(sm, vec3(0.108), band(s, 0.085, w));
    sm = mix(sm, vec3(0.142), band(s, 0.18, w));
    sm = mix(sm, vec3(0.182), band(s, 0.36, w));
    sm = mix(sm, vec3(0.225), band(s, 0.70, w));
    smk = smoothstep(0.012, 0.36, s)*(1.0 - ma.b);
  }
  vec3 col = vec3(mix(sm.r, bR, kR), mix(sm.g, base.g, ma.b), mix(sm.b, bB, kB));

  // rare shot: a flat, hard-edged muzzle flash for ~3 frames, and its light on the gun and hand
  if (uShot.x > 0.0) {
    vec2 px = guv*vec2(1920., 1080.);
    vec2 dq = px - vec2(1772., 324.);
    float ang = atan(dq.y, dq.x);
    float r = length(dq*vec2(0.62, 1.0));
    float R = uShot.x*(26.0 + 46.0*pow(abs(cos(ang*3.5 + uShot.y)), 5.0) + 70.0*exp(-ang*ang/0.035));
    float outer = 1.0 - smoothstep(R - 1.2, R + 1.2, r);
    float inner = 1.0 - smoothstep(R*0.52 - 1.2, R*0.52 + 1.2, r);
    float vis = (1.0 - ma.b)*step(-6.0, dq.x);
    col = mix(col, vec3(0.62), outer*vis);
    col = mix(col, vec3(0.97), inner*vis);
    float lit = uShot.x*exp(-length(dq)/150.0)*ma.b*smoothstep(0.12, 0.25, dot(base, vec3(0.3333)))*(1.0 - ma.g);
    col += vec3(0.33)*lit;
  }

  float lum = dot(col, vec3(0.3333));
  float redM = ma.r, whiteM = ma.g;
  vec2 p = guv*vec2(16., 9.);
  float nR = uNeon.x, nC = uNeon.y;

  // --- neon: a red sign off-screen left rakes across the jacket and the smoke pooled there; a faint cyan one kisses the gun arm ---
  vec2 dl = (p - vec2(-2.2, 3.6))*vec2(1.0, 1.35);
  float fR = exp(-length(dl)*0.30);
  float bars = 0.62 + 0.38*smoothstep(-0.35, 0.35, sin(p.x*1.15 + p.y*2.3 + uT*TAU*32./4096.));
  vec2 dr = (p - vec2(18.4, 6.2))*vec2(1.0, 1.25);
  float fC = exp(-length(dr)*0.30);
  vec3 RED = vec3(1.0, 0.05, 0.07), CYAN = vec3(0.05, 0.78, 0.95);
  float mat = smoothstep(0.08, 0.30, lum)*(1. - redM)*(1. - whiteM)*ma.b + 0.55*smk;   // smoke takes the light more softly than the jacket
  float kNR = nR*fR*bars*mat, kNC = nC*fC*mat;
  col.gb *= 1.0 - 0.55*min(kNR*2.2, 1.0);                 // tint the grey rather than just adding pink
  col.r  *= 1.0 - 0.45*min(kNC*2.2, 1.0);
  col += RED*kNR*1.05 + CYAN*kNC*0.42;
  // haze in the air near each sign
  float hz = 0.55 + 0.45*vn(p*0.55 + vec2(uT*0.0625, 0.));
  col += RED *nR*fR*fR*hz*0.060*(1. - ma.b*0.7);
  col += CYAN*nC*fC*fC*hz*0.030*(1. - ma.b*0.7);

  // emblem answers the red sign; its glow leaks onto the jacket
  col += vec3(0.42, 0.0, 0.0)*redM*(nR - 0.55)*0.55;
  col += vec3(0.55, 0.02, 0.01)*mb.r*mb.r*(0.25 + 0.75*nR)*(0.04 + 0.9*lum)*(1. - redM)*(1. - whiteM)*ma.b;

  // collar lettering buzzes like a tube
  float box = step(0.290, guv.x)*step(guv.x, 0.392)*step(0.220, guv.y)*step(guv.y, 0.282);
  col *= 1.0 - box*whiteM*(1.0 - uNeon.z)*0.78;
  col += vec3(0.9, 0.95, 1.0)*box*mb.g*(1. - whiteM)*0.16*uNeon.z;

  // --- rain: a far layer behind the figure, a sparse near layer in front ---
  float rFar  = rain(p*1.0, 7.0, 5.0, 2.0, 11.)*(1. - ma.b);
  float rNear = rain(p*0.8 + vec2(3.3, 0.), 3.2, 4.0, 2.75, 47.);
  vec3 rainLit = vec3(0.060) + RED*nR*fR*0.30 + CYAN*nC*fC*0.20;
  col += rainLit*(rFar*0.75 + rNear*1.25)*(1. - whiteM);

  // --- transmission: tear tint, static, hum bar, scanlines, grain, vignette ---
  col = mix(col, col*vec3(1.15, 0.95, 1.05) + vec3(0.012, 0.0, 0.02), tearMix*0.6);
  col += vec3(0.16)*staticLine*h21(vec2(gl_FragCoord.x*0.37, seed + gl_FragCoord.y));
  float hum = smoothstep(0.16, 0.0, abs(fract(vUV.y - uT/16.0) - 0.5));
  col *= 1.0 + 0.045*hum;
  col += 0.006*hum;
  float sl = step(mod(gl_FragCoord.y, 3.0), 1.0);
  col *= 1.0 - 0.13*sl;
  float gr = h21(gl_FragCoord.xy + uNeon.w*vec2(61.7, 113.3));
  col += (gr - 0.5)*0.034*(0.6 + 1.2*smoothstep(0.0, 0.4, lum));
  vec2 vq = vUV - 0.5;
  col *= 1.0 - 0.38*dot(vq, vq);

  o = vec4(max(col, 0.0), 1.0);
}`;

  function makeTarget(w, h, linear) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    var f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t: t, fb: fb, w: w, h: h, ok: ok };
  }
  function pair(w, h, linear) {
    var a = makeTarget(w, h, linear), b = makeTarget(w, h, linear);
    return { r: a, w: b, swap: function () { var x = this.r; this.r = this.w; this.w = x; }, ok: a.ok && b.ok };
  }

  var hasSim = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  var vel, prs, dye, curl, div, P = {}, comp, tex = {}, cov = [1, 1, 0, 0], cw = 1, ch = 1;

  function bind(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }
  function pass(prog, target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  var TAU = Math.PI * 2;
  // Shots: one per 48 s slot at a hashed offset (slot 0 fires at t = 6 s, so ?t=6.04&freeze shows the flash).
  var SHOT_SLOT = 48;
  function shotTime(k) { return k * SHOT_SLOT + (k === 0 ? 6 : 6 + 34 * WP.hash2(k % 1000003, 71)); }
  var SHOTS = WP.q.get('shots') !== '0';     // ?shots=0 disables the muzzle flash + burst
  function shotAge(t) {          // seconds since the most recent shot (large if none yet)
    if (!SHOTS) return 1e9;
    var k = Math.floor(t / SHOT_SLOT), a = t - shotTime(k);
    if (a < 0) a = k > 0 ? t - shotTime(k - 1) : 1e9;
    if (t < 0) a = 1e9;
    return a;
  }

  // one simulation step at animation time t (all forcing is a smooth function of t, in double precision)
  function step(t, dt) {
    if (dt <= 0) return;
    var txv = [1 / VW, 1 / VH];
    // forcing
    var gy = -(1.05 + 0.22 * Math.sin(t * 0.043) + 0.10 * Math.sin(t * 0.117 + 1.0));
    var puff = 0.5 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.83 + 0.6 * Math.sin(t * 0.21)), 2.0);
    var ja = -1.25 + 0.30 * Math.sin(t * 0.23) + 0.16 * Math.sin(t * 0.71 + 2.0);     // jet angle, mostly up, a little forward
    var js = 0.8 + 0.25 * Math.sin(t * 0.37 + 1.0);
    var age = shotAge(t), burst = age < 0.22 ? 1 : 0, after = age < 30 ? Math.exp(-age / 2.5) : 0;
    var jx = Math.cos(ja) * js * (1 - burst) + 7.0 * burst, jy = Math.sin(ja) * js * (1 - burst) - 0.3 * burst;

    gl.useProgram(P.adv.p);
    bind(0, vel.r.t); bind(1, dye.r.t);
    gl.uniform1i(P.adv.u.uVel, 0); gl.uniform1i(P.adv.u.uDye, 1);
    gl.uniform1f(P.adv.u.uDt, dt);
    gl.uniform4f(P.adv.u.uWind, gy, 0.30 + 0.08 * Math.sin(t * 0.071 + 0.5), 0.14, 0);
    gl.uniform4f(P.adv.u.uPh, (t * 0.090) % TAU, (t * 0.061) % TAU, (t * 0.137 + 1.3) % TAU, (t * 0.101 + 4.0) % TAU);
    gl.uniform4f(P.adv.u.uJet, jx, jy, 1, 0);
    pass(P.adv, vel.w); vel.swap();

    gl.useProgram(P.curl.p);
    bind(0, vel.r.t); gl.uniform1i(P.curl.u.uVel, 0); gl.uniform2f(P.curl.u.uTx, txv[0], txv[1]);
    pass(P.curl, curl);

    gl.useProgram(P.vort.p);
    bind(0, vel.r.t); bind(1, curl.t);
    gl.uniform1i(P.vort.u.uVel, 0); gl.uniform1i(P.vort.u.uCurl, 1);
    gl.uniform2f(P.vort.u.uTx, txv[0], txv[1]); gl.uniform1f(P.vort.u.uDt, dt); gl.uniform1f(P.vort.u.uConf, +(WP.q.get('conf') || 3.0));
    pass(P.vort, vel.w); vel.swap();

    gl.useProgram(P.div.p);
    bind(0, vel.r.t); gl.uniform1i(P.div.u.uVel, 0); gl.uniform2f(P.div.u.uTx, txv[0], txv[1]);
    pass(P.div, div);

    gl.useProgram(P.jac.p);
    bind(1, div.t); gl.uniform1i(P.jac.u.uDiv, 1); gl.uniform1i(P.jac.u.uP, 0); gl.uniform2f(P.jac.u.uTx, txv[0], txv[1]);
    for (var i = 0; i < JACOBI; i++) { bind(0, prs.r.t); pass(P.jac, prs.w); prs.swap(); }

    gl.useProgram(P.grad.p);
    bind(0, prs.r.t); bind(1, vel.r.t);
    gl.uniform1i(P.grad.u.uP, 0); gl.uniform1i(P.grad.u.uVel, 1); gl.uniform2f(P.grad.u.uTx, txv[0], txv[1]);
    pass(P.grad, vel.w); vel.swap();

    gl.useProgram(P.dye.p);
    bind(0, vel.r.t); bind(1, dye.r.t);
    gl.uniform1i(P.dye.u.uVel, 0); gl.uniform1i(P.dye.u.uDye, 1);
    gl.uniform1f(P.dye.u.uDt, dt);
    gl.uniform4f(P.dye.u.uEmit, 16.0 * puff + 150 * burst + 26 * after, 0.0065 + 0.02 * burst, Math.exp(-dt / 75), 0);
    pass(P.dye, dye.w); dye.swap();
  }

  var H = WP.hash2, WRAP = 4096;

  // Glitch events: time is cut into 9 s slots; ~70% of slots hold one burst of 0.3-0.8 s at a hashed offset.
  // Slot 0 always has a burst starting at t = 4.0 s (so ?t=4.2&freeze lands on one). A shot also rattles the signal.
  var SLOT = 9;
  function glitch(t) {
    var k = Math.floor(t / SLOT), kk = k % 1000003;
    var g = 0, seed = 0, type = 0;
    if (k === 0 || H(kk, 11) < 0.70) {
      var start = k === 0 ? 4.0 : k * SLOT + 1.0 + H(kk, 12) * 6.5;
      var dur = k === 0 ? 0.7 : 0.3 + 0.5 * H(kk, 13);
      var u = (t - start) / dur;
      if (u >= 0 && u < 1) {
        var stp = Math.floor((t - start) / 0.075) + kk * 977;
        var on = H(stp, 14) < 0.78;
        g = on ? (0.4 + 0.6 * H(stp, 15)) * (0.55 + 0.45 * Math.sin(Math.PI * u)) : 0.06;
        seed = 1 + Math.floor(H(stp, 16) * 997);
        type = k === 0 ? 0.9 : H(kk, 17);
      }
    }
    var age = shotAge(t);
    if (age >= 0.07 && age < 0.45) {          // after the flash's three frames, so the flash itself stays clean
      var ks = Math.floor(t / SHOT_SLOT) % 1000003, st2 = Math.floor(age / 0.075) + ks * 613;
      g = Math.max(g, (0.45 + 0.55 * H(st2, 61)) * (1 - age / 0.45));
      seed = 1 + Math.floor(H(st2, 62) * 997); type = 0.2;
    }
    // micro-twitch: a single thin slice hiccups for ~2 frames
    var MS = 3.5, m = Math.floor(t / MS), mm = m % 1000003, micro = 0;
    if (H(mm, 21) < 0.4) {
      var ms = m * MS + 0.3 + H(mm, 22) * 2.8;
      if (t >= ms && t < ms + 0.07) micro = 1 + Math.floor(H(mm, 23) * 997);
    }
    return [g, seed, type, micro];
  }

  // tube flicker: steady, with an occasional stutter of quick dropouts
  function tube(t, salt, slot, prob, low) {
    var k = Math.floor(t / slot), kk = k % 1000003, v = 1;
    if (H(kk, salt) < prob) {
      var start = k * slot + H(kk, salt + 1) * (slot - 1.3), dur = 0.35 + 0.8 * H(kk, salt + 2);
      if (t >= start && t < start + dur) {
        var s = Math.floor((t - start) / 0.066) + kk * 131, r = H(s, salt + 3);
        v = r < 0.40 ? low : (r < 0.62 ? 0.5 + 0.5 * low : 1);
      }
    }
    return v;
  }

  var frameNo = 0;
  function draw(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(comp.p);
    bind(0, tex.base); bind(1, tex.maskA); bind(3, tex.maskB); if (hasSim) bind(2, dye.r.t);
    gl.uniform1i(comp.u.uBase, 0); gl.uniform1i(comp.u.uMA, 1); gl.uniform1i(comp.u.uDye, 2); gl.uniform1i(comp.u.uMB, 3);
    gl.uniform4f(comp.u.uCover, cov[0], cov[1], cov[2], cov[3]);
    gl.uniform2f(comp.u.uDyeSize, DW, DH);
    gl.uniform1f(comp.u.uHasSim, hasSim ? 1 : 0);
    var age = shotAge(t), fl = age < 0.10 ? (age < 0.034 ? 0.7 : (age < 0.067 ? 1.0 : 0.55)) : 0;
    gl.uniform4f(comp.u.uShot, fl, (Math.floor(t / SHOT_SLOT) % 64) * 1.7 + Math.floor(age * 30) * 0.9, 0, 0);
    var g = glitch(t);
    frameNo = (frameNo + 1) % 4096;
    var breathe = 0.90 + 0.10 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1.0);
    var nR = tube(t, 31, 7, 0.75, 0.22) * breathe;
    var nC = tube(t, 41, 13, 0.6, 0.35) * (0.93 + 0.07 * Math.sin(t * 0.53));
    var nS = tube(t, 51, 11, 0.7, 0.12);
    if (g[0] > 0.3) nS = Math.min(nS, 0.55);
    gl.uniform1f(comp.u.uT, t % WRAP);
    gl.uniform4f(comp.u.uG, g[0], g[1], g[2], g[3]);
    gl.uniform4f(comp.u.uNeon, nR, nC, nS, WP.hash(frameNo));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  WP.loadImages({ base: ASSETS.base, maskA: ASSETS.maskA, maskB: ASSETS.maskB }, function (im) {
    comp = WP.program(gl, FS_COMP);
    tex.base = WP.texture(gl, im.base);
    tex.maskA = WP.texture(gl, im.maskA);
    tex.maskB = WP.texture(gl, im.maskB);
    if (hasSim) {
      vel = pair(VW, VH, true); prs = pair(VW, VH, false); dye = pair(DW, DH, true);
      curl = makeTarget(VW, VH, false); div = makeTarget(VW, VH, false);
      hasSim = vel.ok && prs.ok && dye.ok && curl.ok && div.ok;
    }
    if (hasSim) {
      P.adv = WP.program(gl, FS_ADVECT_VEL, SIM_VS); P.curl = WP.program(gl, FS_CURL, SIM_VS);
      P.vort = WP.program(gl, FS_VORT, SIM_VS); P.div = WP.program(gl, FS_DIV, SIM_VS);
      P.jac = WP.program(gl, FS_JACOBI, SIM_VS); P.grad = WP.program(gl, FS_GRAD, SIM_VS);
      P.dye = WP.program(gl, FS_DYE, SIM_VS);
      // pre-roll so the first visible frame already has a developed plume (deterministic for a given ?t=)
      var n = Math.round(WARMUP_S / STEP), w0 = performance.now();
      for (var i = 0; i < n; i++) step(WP.t0 - (n - i) * STEP, STEP);
      if (WP.q.has('debug')) { gl.finish(); console.log('warm-up ' + n + ' steps: ' + Math.round(performance.now() - w0) + ' ms'); }
    } else {
      console.warn('float render targets unavailable: no smoke');
    }
    WP.run(canvas, function (t, dt) {
      if (hasSim) step(t, Math.min(dt, 1 / 20));
      draw(t);
    }, function (w, h) { cw = w; ch = h; cov = WP.cover(w, h); });
  });
})();
