// The hall from designs-os.com/about, as a desktop wallpaper. Same shader (shader.js: VERT, FRAG) and the
// same framing as the About header; the daylight either loops (as on the site) or follows the real clock.
//   ?mode=loop|clock  &loop=<seconds per day>  &fps=<cap>  &scale=<render %>  &tod=<0..1 pins a moment>
(function () {
  const qs = new URLSearchParams(location.search);
  const num = (k, d, lo, hi) => { const v = parseFloat(qs.get(k)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const MODE = qs.get('mode') === 'clock' ? 'clock' : 'loop';
  const DAY_LOOP = num('loop', 84, 20, 86400);
  const FRAME = 1 / num('fps', 30, 5, 120);
  const BASE_SCALE = num('scale', 100, 25, 100) / 100;
  const PIN = qs.has('tod') ? num('tod', 0, 0, 1) : null;
  const canvas = document.getElementById('scene');

  // ---- time of day, 0..1 (the shader's uTod): 0 day, .33 evening, .6 night, .85 dawn
  const lerpKeys = (keys, u) => {
    for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) { const [u0, t0] = keys[i - 1], [u1, t1] = keys[i]; return u1 === u0 ? t1 : t0 + (t1 - t0) * (u - u0) / (u1 - u0); }
    return keys[keys.length - 1][1];
  };
  const LOOP_KEYS = [[0, 0], [.24, .10], [.42, .36], [.52, .55], [.72, .70], [.89, .92], [1, 1]];   // [share of the loop, time of day]
  // [hour, time of day]: night until five, dawn to nine, day to four, golden hour, dusk, night again
  const CLOCK_A = [[0, .62], [5, .68], [6.5, .80], [8, .93], [9, 1]];
  const CLOCK_B = [[9, 0], [16, .10], [18.5, .33], [20.5, .52], [22, .58], [24, .62]];
  const epoch = Date.now();
  function todNow() {
    if (PIN !== null) return PIN;
    if (MODE === 'clock') {
      const d = new Date(), h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      return h < 9 ? lerpKeys(CLOCK_A, h) : lerpKeys(CLOCK_B, h);
    }
    return lerpKeys(LOOP_KEYS, ((Date.now() - epoch) / 1000 / DAY_LOOP) % 1);
  }
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function hallSun(tod) {
    const dawn = sm(.71, .82, tod) * (1 - sm(.87, .985, tod));
    const warm = sm(.10, .33, tod) * (1 - sm(.36, .52, tod)) + .75 * dawn;
    const sw = Math.max(0, Math.sin(2 * Math.PI * tod));
    return { az: -.02 - .17 * sw - .13 * dawn, warm };
  }

  // ---- WebGL
  function setupGL() {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return null;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('shader compile error:\n' + gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG); if (!vs || !fs) return null;
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('program link error: ' + gl.getProgramInfoLog(prog)); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; for (const n of ['uRes', 'uTime', 'uPtr', 'uRoom', 'uTravel', 'uWhite', 'uDusk', 'uBlack', 'uShift', 'uFocal', 'uScroll', 'uSun', 'uQuality', 'uNudge', 'uTod', 'uSoft']) U[n] = gl.getUniformLocation(prog, n);
    return { gl, U };
  }
  const G = setupGL();
  if (!G) { document.body.classList.add('static'); return; }   // no shader: the still image
  const { gl, U } = G;

  let W = 1, H = 1, scale = 1, quality = 1, raf = 0, running = false, last = 0, lastDraw = 0, clock = 0, slow = 0, frames = 0;
  function resize() {
    W = Math.max(1, innerWidth); H = Math.max(1, innerHeight);
    const s = (devicePixelRatio || 1) * BASE_SCALE * scale;
    const w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  function draw(time) {
    const asp = W / H, wide = asp > 1.05;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform2f(U.uPtr, 0, 0);
    gl.uniform1i(U.uRoom, 0);
    gl.uniform1f(U.uTravel, 0); gl.uniform1f(U.uWhite, 0); gl.uniform1f(U.uDusk, 0); gl.uniform1f(U.uScroll, 0); gl.uniform1f(U.uNudge, 0); gl.uniform1f(U.uSoft, 0);
    gl.uniform1f(U.uBlack, .9);
    gl.uniform2f(U.uShift, wide ? -.27 * asp : 0, wide ? .1 : -.56);
    gl.uniform1f(U.uFocal, wide ? 1.9 : Math.min(1.9, asp * 2.4));
    const tod = todNow(), { az, warm } = hallSun(tod);
    gl.uniform1f(U.uTod, tod);
    gl.uniform2f(U.uSun, Math.max(-.3, Math.min(.32, az)), .45 - .23 * warm);
    gl.uniform1i(U.uQuality, quality);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const raw = (now - last) / 1000; last = now;
    // the display's own pace says whether the GPU keeps up: step the quality, then the resolution, down if not
    if (frames > 30) { if (raw > Math.max(.026, FRAME * 1.6)) slow++; else slow = Math.max(0, slow - .5); if (slow > 40) { slow = 0; if (quality > 0) quality = 0; else scale = Math.max(.5, scale * .8); resize(); } }
    if (now - lastDraw < FRAME * 1000 - 2) return;            // frame cap
    clock += Math.min(.1, (now - lastDraw) / 1000); lastDraw = now;
    draw(clock);
    if (frames++ === 1) canvas.classList.add('on');
  }
  const start = () => { if (!running && !document.hidden) { running = true; last = lastDraw = performance.now(); raf = requestAnimationFrame(tick); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  addEventListener('resize', resize); resize();
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); document.body.classList.add('static'); });
  start();
})();
