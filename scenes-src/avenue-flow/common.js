// Runner for Avenue Flow (from the b-422 concept round; plain WebGL2, no build step).
// Scene({ L, frag, textures:{uName:url}, desktop:{cx,cy,zoom}, mobile:{cx,cy,zoom,rotate} })
//  - frames by viewport aspect (landscape -> desktop, portrait -> mobile); ?mode=desktop|mobile forces a
//    16:9 / 9:20 letterboxed stage; ?t=<s> freezes time; loop time t = (now/1000) % L.
//  - mobile.rotate: picture turned 90deg clockwise (reads upright with the phone on its side).
(function () {
  const IMG_W = 5320, IMG_H = 3547;
  const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform float uT, uL, uRot, uPx;      // uPx: picture px per screen px
uniform vec2 uRes, uCenter, uSpan, uVis0, uVis1;
const vec2 IMG = vec2(5320.0, 3547.0);
const float TAU = 6.28318530718;
vec2 imgUV(){ vec2 s = uRot > 0.5 ? vec2(vUv.y, 1.0 - vUv.x) : vUv; return uCenter + (s - 0.5) * uSpan; }
float h11(float n){ return fract(sin(n * 127.1 + 3.7) * 43758.5453); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vn(p); p = p*2.03 + vec2(17.3, 9.1); a *= 0.5; } return s; }
`;
  const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = vec2(aPos.x*0.5+0.5, 0.5-aPos.y*0.5); gl_Position = vec4(aPos,0.0,1.0); }`;

  window.Scene = function (cfg) {
    const q = new URLSearchParams(location.search);
    const forced = q.get('mode');
    const frozen = q.has('t') ? parseFloat(q.get('t')) : null;
    const embedded = window.top !== window;
    document.documentElement.style.cssText = 'height:100%;background:#000';
    document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center';
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    if (!gl) { document.body.textContent = 'WebGL2 not available'; return; }

    function sh(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PRELUDE + cfg.frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);

    let view = null, texScale = 1;
    function layout() {
      let w = window.innerWidth, h = window.innerHeight;
      if (forced === 'desktop' || forced === 'mobile') {
        const a = forced === 'desktop' ? 16 / 9 : 9 / 20;
        if (w / h > a) w = Math.round(h * a); else h = Math.round(w / a);
      }
      const mobile = forced ? forced === 'mobile' : h > w;
      const f = Object.assign({ cx: 0.5, cy: 0.5, zoom: 1, rotate: false }, mobile ? cfg.mobile : cfg.desktop);
      const dpr = Math.min(window.devicePixelRatio || 1, 2, 2600 / Math.max(w, h));
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
      const imgA = IMG_W / IMG_H;
      const A = f.rotate ? canvas.height / canvas.width : canvas.width / canvas.height;   // aspect seen by the picture
      const sx = Math.min(1, A / imgA) / f.zoom, sy = Math.min(1, imgA / A) / f.zoom;     // cover-fit span
      const cx = Math.min(1 - sx / 2, Math.max(sx / 2, f.cx)), cy = Math.min(1 - sy / 2, Math.max(sy / 2, f.cy));
      const along = f.rotate ? canvas.height : canvas.width;
      view = { cx, cy, sx, sy, rot: f.rotate ? 1 : 0, px: IMG_W * sx / along };
      texScale = Math.min(1, 4096 / IMG_W, 1.15 / view.px);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    layout();

    const names = Object.keys(cfg.textures);
    let pending = names.length;
    const builtScale = {};
    const images = {};
    function upload(name, unit) {
      const img = images[name];
      const s = Math.min(1, texScale * IMG_W / img.naturalWidth);
      const w = Math.max(2, Math.round(img.naturalWidth * s)), h = Math.max(2, Math.round(img.naturalHeight * s));
      let srcEl = img;
      if (s < 1) { const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h); srcEl = c; }
      gl.activeTexture(gl.TEXTURE0 + unit);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcEl);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(U(name), unit);
      // mip level that corresponds to 1 full-res picture px, so shaders can ask for blur radii in picture px
      gl.uniform1f(U(name + 'Lod'), Math.log2(w / IMG_W));
    }
    names.forEach((name, unit) => {
      const img = new Image();
      img.onload = () => { images[name] = img; upload(name, unit); if (--pending === 0) start(); };
      img.onerror = () => console.error('failed to load', cfg.textures[name]);
      img.src = cfg.textures[name];
    });

    function draw(t) {
      gl.uniform1f(U('uT'), t); gl.uniform1f(U('uL'), cfg.L);
      gl.uniform2f(U('uRes'), canvas.width, canvas.height);
      gl.uniform2f(U('uCenter'), view.cx, view.cy); gl.uniform2f(U('uSpan'), view.sx, view.sy);
      gl.uniform2f(U('uVis0'), view.cx - view.sx / 2, view.cy - view.sy / 2);
      gl.uniform2f(U('uVis1'), view.cx + view.sx / 2, view.cy + view.sy / 2);
      gl.uniform1f(U('uRot'), view.rot); gl.uniform1f(U('uPx'), view.px);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    let last = -1e9, raf = 0;
    function frame(now) {
      raf = 0;
      if (document.hidden) return;
      if (frozen === null) raf = requestAnimationFrame(frame);
      if (embedded && now - last < 31) return;          // ~30 fps inside the gallery iframes
      last = now;
      draw(frozen !== null ? frozen % cfg.L : (now / 1000) % cfg.L);
      document.title = cfg.title + ' (ready)';
    }
    function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
    function start() {
      kick();
      document.addEventListener('visibilitychange', kick);
      let rt = 0;
      window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
        const old = texScale; layout();
        if (texScale > old * 1.3 || texScale < old / 2) names.forEach(upload);
        kick(); }, 120); });
    }
  };
})();
