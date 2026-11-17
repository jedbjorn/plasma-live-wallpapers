// Runner for The Surge (from the b-209 concept round). index.html calls Scene({L, frame, frag}).
//   L      loop length in seconds; everything in the shader is periodic in L
//   frame  (portrait:boolean, aspect:number) -> {cx, cy, zoom, free}
//          cx,cy = point of the picture (0..1) to centre on, zoom 1 = cover-fit, free = may leave the picture
//   frag   body of the fragment shader (GLSL ES 3.00), must define  vec3 scene(vec2 p)
//          p = screen position 0..1 (y down). Use  UV(p)  to get picture coordinates.
// Query: ?t=<seconds> freezes time, ?mode=desktop|mobile forces a 16:9 / 9:20 framing.
(function () {
  const IMG_ASPECT = 3840 / 2400;
  const HEAD = `#version 300 es
precision highp float;
uniform sampler2D u_img, u_masks, u_soft, u_wide;
uniform float u_t, u_L, u_portrait, u_px;
uniform vec2 u_res, u_center, u_span;
out vec4 outColor;
#define TAU 6.28318530718
#define ASPECT 1.6
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
// value noise that tiles with period 'per' (in lattice cells)
float pnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  vec2 a = mod(i, per), b = mod(i+1.0, per);
  return mix(mix(hash(a), hash(vec2(b.x,a.y)), f.x), mix(hash(vec2(a.x,b.y)), hash(b), f.x), f.y);
}
float pfbm(vec2 p, vec2 per){
  float a = 0.5, s = 0.0;
  for(int k=0;k<4;k++){ s += a*pnoise(p, per); p = p*2.0 + 17.3; per *= 2.0; a *= 0.5; }
  return s/0.9375;
}
vec2 UV(vec2 p){ return u_center + (p-0.5)*u_span; }
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
// c(n) / s(n): cosine / sine making n whole cycles per loop
float cyc(float n, float ph){ return sin(TAU*(n*u_t/u_L + ph)); }
`;
  const TAIL = `
void main(){
  vec2 p = vec2(gl_FragCoord.x/u_res.x, 1.0 - gl_FragCoord.y/u_res.y);
  outColor = vec4(clamp(scene(p), 0.0, 1.0), 1.0);
}`;
  const VERT = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

  window.Scene = function (opt) {
    const q = new URLSearchParams(location.search);
    const mode = q.get('mode');
    const frozen = q.has('t') ? parseFloat(q.get('t')) : null;
    document.documentElement.style.cssText = 'height:100%;background:#000';
    document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#000';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;display:block';
    document.body.appendChild(cv);
    const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) { document.body.textContent = 'WebGL2 not available'; return; }

    function sh(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); throw new Error('shader'); }
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, HEAD + opt.frag + TAIL));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);

    function load(url, unit, name, mips) {
      return new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => {
          const t = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          if (mips) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
          else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.uniform1i(U(name), unit); res();
        };
        im.onerror = () => rej(new Error('load ' + url));
        im.src = url;
      });
    }

    let W = 0, H = 0;
    function layout() {
      let vw = innerWidth, vh = innerHeight, w = vw, h = vh;
      if (mode === 'desktop' || mode === 'mobile') {
        const a = mode === 'desktop' ? 16 / 9 : 9 / 20;
        if (vw / vh > a) { h = vh; w = Math.round(vh * a); } else { w = vw; h = Math.round(vw / a); }
      }
      cv.style.left = ((vw - w) / 2) + 'px'; cv.style.top = ((vh - h) / 2) + 'px';
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.width = Math.max(1, Math.round(w * dpr)); H = cv.height = Math.max(1, Math.round(h * dpr));
      gl.viewport(0, 0, W, H);
      const A = W / H, portrait = A < 1;
      const f = opt.frame(portrait, A), z = f.zoom || 1;
      let sx, sy;
      if (A > IMG_ASPECT) { sx = 1 / z; sy = (IMG_ASPECT / A) / z; } else { sy = 1 / z; sx = (A / IMG_ASPECT) / z; }
      let cx = f.cx, cy = f.cy;
      if (!f.free) {
        cx = sx >= 1 ? 0.5 : Math.min(1 - sx / 2, Math.max(sx / 2, cx));
        cy = sy >= 1 ? 0.5 : Math.min(1 - sy / 2, Math.max(sy / 2, cy));
      }
      gl.uniform2f(U('u_res'), W, H); gl.uniform2f(U('u_center'), cx, cy); gl.uniform2f(U('u_span'), sx, sy);
      gl.uniform1f(U('u_portrait'), portrait ? 1 : 0);
      gl.uniform1f(U('u_px'), sy / H);   // one screen pixel in picture-v units
    }
    function draw() {
      const t = frozen !== null ? ((frozen % opt.L) + opt.L) % opt.L : (performance.now() / 1000) % opt.L;
      gl.uniform1f(U('u_t'), t); gl.uniform1f(U('u_L'), opt.L);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    let raf = 0;
    function tick() { raf = 0; if (document.hidden) return; draw(); if (frozen === null) raf = requestAnimationFrame(tick); }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }
    Promise.all([
      load('still.jpg', 0, 'u_img', true), load('masks.png', 1, 'u_masks', false),
      load('soft.jpg', 2, 'u_soft', false), load('wide.jpg', 3, 'u_wide', false),
    ]).then(() => {
      layout(); draw(); window.__ready = true; kick();
      addEventListener('resize', () => { layout(); draw(); kick(); });
      document.addEventListener('visibilitychange', kick);
    }).catch(e => console.error(e));
  };
})();
