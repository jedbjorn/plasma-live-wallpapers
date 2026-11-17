// Runtime for Embers (from the b-219 concept round): framing, seamless loop clock, WebGL plumbing.
// index.html calls Concept({ L, frag, landscape, portrait, points? }).
//   frag   : GLSL defining  vec3 scene(vec2 uv)  (uv = picture coords, 0..1, y down)
//   points : optional additive point-sprite pass { count, vert, frag }
// Query: ?t=<seconds> freezes time, ?mode=desktop|mobile forces a 16:9 / 9:20 framing.
(function () {
  'use strict';
  const IMG_ASPECT = 2560 / 1440;
  const q = new URLSearchParams(location.search);
  const frozenT = q.has('t') ? parseFloat(q.get('t')) : null;
  const mode = q.get('mode');

  const PRELUDE = `
precision highp float;
uniform sampler2D u_img, u_mask;
uniform float u_t, u_L, u_port;
uniform vec2 u_res;
uniform mat3 u_s2i, u_i2s;
const float TAU = 6.28318530718;
const float ASPECT = ${IMG_ASPECT.toFixed(6)};
const vec2 VP = vec2(0.502, 0.66);     // vanishing point / glow at the end of the path
const float HORIZON = 0.685;           // where the ground starts
float ph(float cycles) { return TAU * cycles * u_t / u_L; }   // whole cycles per loop
float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash3(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
// value noise, periodic with period 'per' (whole numbers) on every axis
float pnoise(vec3 p, vec3 per) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  vec3 i1 = mod(i + 1., per); i = mod(i, per);
  return mix(mix(mix(hash3(i), hash3(vec3(i1.x, i.y, i.z)), f.x),
                 mix(hash3(vec3(i.x, i1.y, i.z)), hash3(vec3(i1.x, i1.y, i.z)), f.x), f.y),
             mix(mix(hash3(vec3(i.x, i.y, i1.z)), hash3(vec3(i1.x, i.y, i1.z)), f.x),
                 mix(hash3(vec3(i.x, i1.y, i1.z)), hash3(i1), f.x), f.y), f.z);
}
float pfbm(vec3 p, vec3 per) {
  float a = .5, s = 0.;
  for (int k = 0; k < 4; k++) { s += a * pnoise(p, per); p *= 2.; per *= 2.; a *= .5; }
  return s / .9375;
}
vec3 pic(vec2 uv) { return texture2D(u_img, uv).rgb; }
vec3 msk(vec2 uv) { return texture2D(u_mask, uv).rgb; }   // r light, g occluder, b depth(far=1)
vec3 screenBlend(vec3 a, vec3 b) { return 1. - (1. - a) * (1. - clamp(b, 0., 1.)); }
`;
  const VERT = `attribute vec2 a_p; varying vec2 v_s;
void main(){ v_s = vec2(a_p.x * .5 + .5, .5 - a_p.y * .5); gl_Position = vec4(a_p, 0., 1.); }`;
  const MAIN = `
varying vec2 v_s;
void main(){
  vec2 uv = (u_s2i * vec3(v_s, 1.)).xy;
  vec3 c = scene(uv);
  c += (hash2(gl_FragCoord.xy) - .5) / 255.;   // static dither against banding in the darks
  gl_FragColor = vec4(c, 1.);
}`;

  function compile(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function loadTex(gl, unit, url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        res(t);
      };
      im.onerror = () => rej(new Error('cannot load ' + url));
      im.src = url;
    });
  }
  // seeded PRNG (mulberry32): particle seeds are fixed, never Math.random()
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  window.Concept = async function (cfg) {
    document.documentElement.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
    document.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;display:block';
    document.body.appendChild(cv);
    const gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: frozenT !== null });
    if (!gl) { document.body.style.background = '#000 url(still.jpg) center/cover'; return; }

    const prog = compile(gl, VERT, PRELUDE + cfg.frag + MAIN);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    let pts = null;
    if (cfg.points) {
      const n = cfg.points.count, r = rng(cfg.points.seed || 219), data = new Float32Array(n * 4);
      for (let i = 0; i < n * 4; i++) data[i] = r();
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      pts = { n, buf, prog: compile(gl, PRELUDE + 'uniform float u_pxh;\nattribute vec4 a_seed;\n' + cfg.points.vert, PRELUDE + cfg.points.frag) };
    }
    await Promise.all([loadTex(gl, 0, cfg.image || 'still.jpg'), loadTex(gl, 1, cfg.mask || 'masks.png')]);

    let s2i, i2s, port = 0, pxh = 1;
    function layout() {
      let W = innerWidth, H = innerHeight, x = 0, y = 0;
      const forced = mode === 'desktop' ? 16 / 9 : mode === 'mobile' ? 9 / 20 : 0;
      if (forced) {
        const w = Math.min(W, H * forced), h = w / forced;
        x = (W - w) / 2; y = (H - h) / 2; W = w; H = h;
      }
      cv.style.left = x + 'px'; cv.style.top = y + 'px'; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      let s = Math.min(devicePixelRatio || 1, 2);
      s = Math.min(s, Math.sqrt(3.8e6 / (W * H * s * s)) * s);   // cap the pixel count
      cv.width = Math.max(1, Math.round(W * s)); cv.height = Math.max(1, Math.round(H * s));
      const asp = W / H;
      port = asp < 1 ? 1 : 0;
      const f = port ? cfg.portrait : cfg.landscape, zoom = f.zoom || 1;
      const clamp = (c, fr) => Math.min(1 - fr / 2, Math.max(fr / 2, c));
      let m; // row-major 2x3: [a b c; d e f]  uv = m * (s,1)
      if (f.rotate) {       // picture turned 90deg clockwise
        const fu = Math.min(1, (1 / asp) / IMG_ASPECT) / zoom, fv = Math.min(1, IMG_ASPECT / (1 / asp)) / zoom;
        const cx = clamp(f.focus[0], fu), cy = clamp(f.focus[1], fv);
        m = [0, fu, cx - fu / 2, -fv, 0, cy + fv / 2];
        pxh = cv.width / fv;
      } else {
        const fw = Math.min(1, asp / IMG_ASPECT) / zoom, fh = Math.min(1, IMG_ASPECT / asp) / zoom;
        const cx = clamp(f.focus[0], fw), cy = clamp(f.focus[1], fh);
        m = [fw, 0, cx - fw / 2, 0, fh, cy - fh / 2];
        pxh = cv.height / fh;
      }
      const det = m[0] * m[4] - m[1] * m[3];
      const inv = [m[4] / det, -m[1] / det, (m[1] * m[5] - m[4] * m[2]) / det, -m[3] / det, m[0] / det, (m[3] * m[2] - m[0] * m[5]) / det];
      const col = a => new Float32Array([a[0], a[3], 0, a[1], a[4], 0, a[2], a[5], 1]);  // column-major mat3
      s2i = col(m); i2s = col(inv);
    }
    function uniforms(p, t) {
      gl.useProgram(p);
      const U = n => gl.getUniformLocation(p, n);
      gl.uniform1i(U('u_img'), 0); gl.uniform1i(U('u_mask'), 1);
      gl.uniform1f(U('u_t'), t); gl.uniform1f(U('u_L'), cfg.L); gl.uniform1f(U('u_port'), port);
      gl.uniform2f(U('u_res'), cv.width, cv.height);
      gl.uniformMatrix3fv(U('u_s2i'), false, s2i); gl.uniformMatrix3fv(U('u_i2s'), false, i2s);
      return U;
    }
    function draw() {
      const t = frozenT !== null ? ((frozenT % cfg.L) + cfg.L) % cfg.L : (performance.now() / 1000) % cfg.L;
      gl.viewport(0, 0, cv.width, cv.height);
      gl.disable(gl.BLEND);
      uniforms(prog, t);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const a = gl.getAttribLocation(prog, 'a_p');
      gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (pts) {
        const U = uniforms(pts.prog, t);
        gl.uniform1f(U('u_pxh'), pxh);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, pts.buf);
        const s = gl.getAttribLocation(pts.prog, 'a_seed');
        gl.enableVertexAttribArray(s); gl.vertexAttribPointer(s, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, pts.n);
      }
      window.__rendered = true;
    }
    let raf = 0;
    function tick() { raf = 0; if (document.hidden) return; draw(); if (frozenT === null) raf = requestAnimationFrame(tick); }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }
    addEventListener('resize', () => { layout(); kick(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    layout(); draw(); kick();
  };
})();
