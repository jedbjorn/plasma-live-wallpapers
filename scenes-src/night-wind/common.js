// Runner for Night Wind (from the b-867 concept round). No build step, no dependencies.
// index.html calls Concept.run({ L, landscape, portrait, textures, frag }).
//   L          loop length in seconds; everything is driven from t = now % L  (or ?t=<seconds> to freeze)
//   landscape  { focus:[x,y], zoom }            focus = source pixel kept at the centre (clamped to cover)
//   portrait   { focus:[x,y], zoom, rotate }    rotate:true turns the whole picture 90deg clockwise
//   textures   { uName: 'file', ... }           uImg (the picture) is always loaded, with mipmaps
//   frag       GLSL that defines  vec3 scene(vec2 p)   with p in source pixels (3000x1688, y down)
// ?mode=desktop / ?mode=mobile force a 16:9 / 9:20 box inside the window.
(function () {
  const SRC = [3000, 1688];
  const qs = new URLSearchParams(location.search);
  const mode = qs.get('mode');
  const frozen = qs.has('t') ? parseFloat(qs.get('t')) : null;

  const PRELUDE = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform vec2 uRes, uC, uAx, uAy;
uniform float uT, uL, uPx, uPortrait;
out vec4 outColor;
const vec2 SRC = vec2(3000.0, 1688.0);
const vec2 MOON = vec2(658.0, 448.0);
const float TAU = 6.28318530718;
float hash1(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec2 hash2(vec2 p){ float n = hash1(p); return vec2(n, hash1(p+n+17.1)); }
// the picture, at source pixel p (ink = luminance)
float img(vec2 p){ return texture(uImg, p/SRC).r; }
float imgLod(vec2 p, float lod){ return textureLod(uImg, p/SRC, lod).r; }
// small blur: turns ink dots into a grey value that can be re-thresholded ("swell / erode" in pure ink)
float imgSoft(vec2 p, float r){
  float lod = max(log2(max(r, 1.0)), log2(uPx)) ;
  vec2 o = vec2(r*0.75, r*0.31);
  return 0.25*(imgLod(p+o, lod)+imgLod(p-o, lod)+imgLod(p+vec2(-o.y,o.x), lod)+imgLod(p+vec2(o.y,-o.x), lod));
}
// hard ink edge with just enough softness to antialias at the current scale
float ink(float v, float thr){ float e = 0.06 + 0.22*clamp(uPx-1.0, 0.0, 2.0); return smoothstep(thr-e, thr+e, v); }
`;
  const MAIN = `
void main(){
  vec2 d = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - 0.5*uRes;
  vec2 p = uC + uAx*d.x + uAy*d.y;
  outColor = vec4(clamp(scene(p), 0.0, 1.0), 1.0);
}`;

  function run(cfg) {
    document.documentElement.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
    document.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;display:block';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) { document.body.textContent = 'WebGL2 not available'; return; }

    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PRELUDE + cfg.frag + MAIN));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.bindAttribLocation(prog, 0, 'a');
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'a'), 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);

    const texs = Object.assign({ uImg: 'still.jpg' }, cfg.textures || {});
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const loads = Object.keys(texs).map((name, i) => new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (name === 'uImg') {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
        } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.uniform1i(U(name), i); ok();
      };
      im.onerror = () => fail(new Error('cannot load ' + texs[name]));
      im.src = texs[name];
    }));

    let portrait = false;
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
      const cap = cfg.maxPixels || 2560 * 1440;
      if (w * h * s * s > cap) s = Math.sqrt(cap / (w * h));
      canvas.width = Math.max(1, Math.round(w * s)); canvas.height = Math.max(1, Math.round(h * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      portrait = mode ? mode === 'mobile' : h > w;
      const f = portrait ? (cfg.portrait || {}) : (cfg.landscape || {});
      const rot = !!f.rotate, zoom = f.zoom || 1;
      const W = canvas.width, H = canvas.height;
      // image extent along screen x / y, in source pixels
      const ex = rot ? SRC[1] : SRC[0], ey = rot ? SRC[0] : SRC[1];
      const scale = Math.max(W / ex, H / ey) * zoom;          // canvas px per source px
      const hx = W / scale / 2, hy = H / scale / 2;           // half view, in source px along screen axes
      let [fx, fy] = f.focus || [SRC[0] / 2, SRC[1] / 2];
      const clamp = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));
      if (rot) { fx = clamp(fx, hy, SRC[0] - hy); fy = clamp(fy, hx, SRC[1] - hx); }
      else { fx = clamp(fx, hx, SRC[0] - hx); fy = clamp(fy, hy, SRC[1] - hy); }
      gl.uniform2f(U('uRes'), W, H);
      gl.uniform2f(U('uC'), fx, fy);
      // 90deg clockwise: screen right = source up, screen down = source right
      if (rot) { gl.uniform2f(U('uAx'), 0, -1 / scale); gl.uniform2f(U('uAy'), 1 / scale, 0); }
      else { gl.uniform2f(U('uAx'), 1 / scale, 0); gl.uniform2f(U('uAy'), 0, 1 / scale); }
      gl.uniform1f(U('uPx'), 1 / scale);
      gl.uniform1f(U('uPortrait'), portrait ? 1 : 0);
    }

    function draw() {
      const t = frozen !== null ? frozen : performance.now() / 1000;
      gl.uniform1f(U('uT'), ((t % cfg.L) + cfg.L) % cfg.L);
      gl.uniform1f(U('uL'), cfg.L);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    let raf = 0;
    function frame() { raf = 0; if (document.hidden) return; draw(); if (frozen === null) raf = requestAnimationFrame(frame); }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    Promise.all(loads).then(() => {
      layout(); draw(); window.__ready = true; kick();
      addEventListener('resize', () => { layout(); draw(); kick(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    }).catch(e => { console.error(e); document.body.textContent = String(e); });
  }
  window.Concept = { run };
})();
