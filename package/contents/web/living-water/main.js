/* "Living Water": Living Pond's swimming koi (procedural, Canvas2D, drawn off screen) seen through
   Still Water's surface (one WebGL2 pass: swell refraction, caustic light, ripple rings, motes, glow). */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var FPS = Math.min(240, Math.max(1, parseFloat(q.get('fps')) || 30));
  var T0 = Math.max(0, parseFloat(q.get('t')) || 0);
  var SPEED = parseFloat(q.get('speed'));                 // ?speed=: how fast the koi swim, 1 = normal (the water keeps its own pace)
  SPEED = isFinite(SPEED) ? Math.min(5, Math.max(0.05, SPEED)) : 1;
  var DW = 1920, DH = 1080, MAXPX = 1920 * 1080, TAU = Math.PI * 2, NR = 4;

  var canvas = document.getElementById('c');
  var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  var pond = gl ? document.createElement('canvas') : canvas;      // without WebGL the pond is drawn straight to the page
  var ctx = pond.getContext('2d', { alpha: false });
  var bg = document.createElement('canvas');
  var W = 0, H = 0, scale = 1, ox = 0, oy = 0;

  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---- the pond (Canvas2D) ---- */
  function buildBackground() {
    bg.width = W; bg.height = H;
    var b = bg.getContext('2d', { alpha: false });
    b.fillStyle = '#0e0f13'; b.fillRect(0, 0, W, H);
    b.setTransform(scale, 0, 0, scale, ox, oy);
    var P = Koi.POOL, R = 780, g = b.createRadialGradient(P.x, P.y, 0, P.x, P.y, R), i;
    for (i = 0; i <= 16; i++) {                       // fitted falloff of the source image's pool
      var u = 1 - i / 16, f = Math.pow(u * u * (3 - 2 * u), 0.85);
      g.addColorStop(i / 16, 'rgb(' + (14 + 19 * f).toFixed(1) + ',' + (15 + 25 * f).toFixed(1) + ',' + (19 + 32 * f).toFixed(1) + ')');
    }
    b.fillStyle = g; b.fillRect(P.x - R, P.y - R, 2 * R, 2 * R);
    b.setTransform(1, 0, 0, 1, 0, 0);
  }

  var school = new Koi.School({ mode: 'pond' });
  var ts = Math.max(0, T0 - 600);         // the school's own clock; pre-roll it to the requested time (bounded)
  while (ts < T0 - 1e-6) { var st = Math.min(1 / 30, T0 - ts); school.step(st, ts); ts += st; }
  var t = T0;                             // the water's clock

  function drawPond() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    var glow = 0.86 + 0.10 * Math.sin(t * 0.55) + 0.04 * Math.sin(t * 1.31 + 1.0);
    school.draw(ctx, glow);
  }

  /* ---- the surface (WebGL2) ---- */
  var U = {}, tex = null, ring = new Float32Array(NR * 4);
  if (gl) {
    var VS = '#version 300 es\nvoid main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }';
    var FS = [
      '#version 300 es',
      'precision highp float;',
      'out vec4 o;',
      'uniform sampler2D uTex;',                          // the pond canvas, at canvas resolution
      'uniform vec2 uRes; uniform vec3 uMap;',            // uMap: scale, offsetX, offsetY (design px -> canvas px)
      'uniform vec4 uRing[' + NR + '];',                  // x, y, radius, strength
      'uniform vec4 uWave;',                              // 4 wrapped phases for the surface swell
      'uniform vec4 uCau;',                               // wrapped caustic phases
      'uniform vec4 uMote;',                              // drift.xy (wrapped), 2 phases
      'uniform vec4 uGlow;',                              // orange koi x, y (design px), pulse, flicker
      'float hash(vec2 p){ p = fract(p*vec2(0.1031,0.1030)); p += dot(p, p.yx+33.33); return fract((p.x+p.y)*p.y); }',
      'void main(){',
      '  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
      '  vec2 p = (fc - uMap.yz) / uMap.x;',               // design-space pixel
      '  vec2 d = vec2(0.0); float light = 0.0, ringL = 0.0;',
      // surface swell: a few crossing sine trains, domain-warped by each other
      '  vec2 w = p * 0.0052;',
      '  float a1 = sin(w.x*1.3 + w.y*0.7 + uWave.x), a2 = sin(-w.x*0.6 + w.y*1.5 + uWave.y);',
      '  float a3 = sin(w.x*2.3 - w.y*1.9 + uWave.z + a1*1.3), a4 = sin(w.x*1.1 + w.y*3.1 + uWave.w + a2*1.1);',
      '  d += vec2(a1*0.9 + a3*0.8 - a4*0.5, a2*0.9 - a3*0.6 + a4*0.8) * 1.6;',
      '  light += (a3*a4 + 0.5*a1*a2) * 0.25;',
      // expanding ripple rings
      '  for (int i = 0; i < ' + NR + '; i++) {',
      '    vec4 r = uRing[i];',
      '    if (r.w > 0.0) {',
      '      vec2 v = p - r.xy; float l = length(v) + 1e-3;',
      '      float x = (l - r.z) / 6.5;',
      '      float env = exp(-x*x*0.22) * smoothstep(0.0, 50.0, l);',
      '      float wv = sin(x*1.55) * env * r.w;',
      '      d += (v / l) * wv * 3.2;',
      '      ringL += (cos(x*1.55) * 0.75 + 0.25) * env * r.w;',
      '    }',
      '  }',
      '  vec2 uv = ((p - d) * uMap.x + uMap.yz) / uRes;',
      '  vec3 col = texture(uTex, uv).rgb;',
      '  float lum = dot(col, vec3(0.3, 0.5, 0.2));',
      '  vec2 pc = p - vec2(980.0, 690.0);',
      '  float pool = smoothstep(820.0, 120.0, length(pc));',
      // caustic shimmer (cheap iterated-trig caustic), lights the pool faintly and the fish backs more
      '  vec2 cp = p * 0.0105 + vec2(37.0, 11.0); vec2 ci = cp; float cc = 1.0;',
      '  for (int n = 0; n < 4; n++) {',
      '    float t = uCau[n];',
      '    ci = cp + vec2(cos(t - ci.x) + sin(t + ci.y), sin(t - ci.y) + cos(t + ci.x));',
      '    cc += 1.0 / length(vec2(1.25 / sin(ci.x + t), 1.25 / cos(ci.y + t)));',
      '  }',
      '  cc = 1.17 - pow(cc / 4.0, 1.4);',
      '  float ca = clamp(pow(abs(cc), 8.0), 0.0, 1.0);',
      '  float fishMask = smoothstep(0.16, 0.5, lum);',
      '  col += vec3(0.55, 0.72, 1.0) * ca * (0.050 * pool + 0.20 * fishMask);',
      '  col += vec3(0.5, 0.65, 0.9) * light * (0.022 * pool + 0.035 * fishMask);',
      '  col += vec3(0.50, 0.64, 0.88) * ringL * (0.062 * (0.3 + 0.7 * pool) + 0.07 * fishMask);',
      // the orange koi lights the water around it, wherever it has swum to
      '  float od = length(p - uGlow.xy);',
      '  float warm = max(col.r - col.b, 0.0);',
      '  col += vec3(1.0, 0.50, 0.16) * (exp(-od / 120.0) * 0.050 + exp(-od / 320.0) * 0.020) * uGlow.z;',
      '  col *= 1.0 + warm * (0.22 * uGlow.z + 0.05 * uGlow.w) * exp(-od / 90.0);',
      // drifting motes, one per grid cell
      '  for (int k = 0; k < 2; k++) {',
      '    float cs = k == 0 ? 150.0 : 230.0;',
      '    vec2 mp = p + uMote.xy * (k == 0 ? 1.0 : 0.6) + float(k) * 71.3;',
      '    vec2 cell = floor(mp / cs), f = mp - cell * cs;',
      '    cell = mod(cell, 64.0);',
      '    float h1 = hash(cell + 3.1 + float(k)*17.0), h2 = hash(cell.yx + 9.7), h3 = hash(cell + 21.3);',
      '    vec2 mc = vec2(0.5) * cs + (vec2(h1, h2) - 0.5) * cs * 0.6 + 9.0 * vec2(sin(uMote.z + h3*6.283), cos(uMote.w + h1*6.283));',
      '    float md = length(f - mc);',
      '    float tw = 0.55 + 0.45 * sin(uMote.z * 2.0 + h2 * 6.283);',
      '    col += vec3(0.62, 0.72, 0.92) * smoothstep(1.0 + 1.4*h3, 0.2, md) * tw * step(0.45, h3) * 0.085 * pool;',
      '  }',
      '  col += (hash(gl_FragCoord.xy + uMote.zw * 37.0) - 0.5) / 255.0 * 2.0;',    // dither: hides banding in the dark gradient
      '  o = vec4(col, 1.0);',
      '}'
    ].join('\n');
    var compile = function (type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    ['uTex', 'uRes', 'uMap', 'uRing', 'uWave', 'uCau', 'uMote', 'uGlow'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.bindVertexArray(gl.createVertexArray());
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.uTex, 0);
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, window.innerWidth) * dpr, h = Math.max(1, window.innerHeight) * dpr, k = Math.min(1, Math.sqrt(MAXPX / (w * h)));
    W = Math.max(1, Math.round(w * k)); H = Math.max(1, Math.round(h * k));
    canvas.width = W; canvas.height = H;
    if (pond !== canvas) { pond.width = W; pond.height = H; }
    scale = Math.max(W / DW, H / DH);
    ox = (W - DW * scale) / 2; oy = (H - DH * scale) / 2;
    buildBackground();
    if (gl) { gl.viewport(0, 0, W, H); gl.uniform2f(U.uRes, W, H); gl.uniform3f(U.uMap, scale, ox, oy); }
  }

  function ph(rate, off) { return (t * rate + (off || 0)) % TAU; }
  var RING_SLOTS = [[13.0, 0.0], [19.0, 6.5], [29.0, 3.0], [41.0, 17.0]];   // period, offset
  var LIFE = 10.0;

  function render() {
    drawPond();
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pond);
    for (var i = 0; i < NR; i++) {
      var per = RING_SLOTS[i][0], tt = t + RING_SLOTS[i][1];
      var k = Math.floor(tt / per), age = tt - k * per, id = (k % 100003) * NR + i;
      var str = 0;
      if (age < LIFE) {
        var u = age / LIFE;
        str = Math.pow(1 - u, 1.3) * Math.min(1, age * 1.5) * (0.55 + 0.45 * hash(id * 3.3 + 1));
        var ang = hash(id * 1.37 + 9) * TAU, rad = 60 + hash(id * 2.11 + 4) * 480;
        ring[i * 4] = 980 + Math.cos(ang) * rad;
        ring[i * 4 + 1] = 690 + Math.sin(ang) * rad * 0.62;
        ring[i * 4 + 2] = age * 34;
      }
      ring[i * 4 + 3] = str;
    }
    gl.uniform4fv(U.uRing, ring);
    gl.uniform4f(U.uWave, ph(0.33), ph(0.27, 1.3), ph(0.46, 2.1), ph(0.39, 4.0));
    gl.uniform4f(U.uCau, ph(0.26 * (1 - 3.5 / 1)), ph(0.26 * (1 - 3.5 / 2)), ph(0.26 * (1 - 3.5 / 3)), ph(0.26 * (1 - 3.5 / 4)));
    gl.uniform4f(U.uMote, (t * 3.1) % (64 * 150 * 230), (t * -4.3) % (64 * 150 * 230), ph(0.17), ph(0.13, 2.0));
    var pulse = 0.5 + 0.5 * Math.sin(ph(0.62)), o = school.orange;
    gl.uniform4f(U.uGlow, o.midX, o.midY, 0.25 + 0.75 * pulse * pulse * (3 - 2 * pulse), Math.sin(ph(1.9, 1.0)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---- loop ---- */
  var raf = 0, last = 0, frameMs = 1000 / FPS;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now - frameMs;
    var el = now - last;
    if (el < frameMs - 1.5) return;
    last = el > frameMs * 4 ? now : now - (el % frameMs);
    var dt = Math.min(el / 1000, 0.1);
    var ds = dt * SPEED, steps = Math.max(1, Math.ceil(ds / 0.04));      // sub-step so long or fast frames stay stable
    for (var i = 0; i < steps; i++) { school.step(ds / steps, ts); ts += ds / steps; }
    t += dt;
    render();
  }
  function start() { if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  window.addEventListener('resize', function () { resize(); render(); });
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); });
  canvas.addEventListener('webglcontextrestored', function () { location.reload(); });

  resize();
  render();
  start();
})();
