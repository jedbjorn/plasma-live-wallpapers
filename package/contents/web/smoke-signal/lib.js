// Shared live-wallpaper harness: params, cover-fit canvas, capped frame loop, GL helpers.
// Classic script, no modules, no network.
var WP = (function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var fps = parseFloat(q.get('fps'));
  if (!(fps > 0)) fps = 30;
  fps = Math.min(240, Math.max(1, fps));
  var t0 = parseFloat(q.get('t'));
  if (!isFinite(t0)) t0 = 0;
  var frozen = q.has('freeze');   // testing aid: hold the clock at ?t=
  var MAX_PIXELS = 1920 * 1080;
  var IMG_W = 1920, IMG_H = 1080;

  function sizeCanvas(canvas) {
    var cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
    var dpr = window.devicePixelRatio || 1;
    var w = cw * dpr, h = ch * dpr;
    var k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  }

  // "cover" mapping: imageUV = screenUV * scale + offset (screenUV has y=0 at top)
  function cover(w, h) {
    var s = Math.max(w / IMG_W, h / IMG_H);
    var sx = w / (IMG_W * s), sy = h / (IMG_H * s);
    return [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map(function (l, i) { return (i + 1) + ': ' + l; }).join('\n'));
      throw new Error('shader compile failed');
    }
    return s;
  }
  var VS = '#version 300 es\nout vec2 vUV;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUV=vec2(p.x,1.0-p.y);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
  function program(gl, fs, vs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs || VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); throw new Error('link failed'); }
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p: p, u: u };
  }

  function loadImages(map, cb) {
    var keys = Object.keys(map), out = {}, left = keys.length;
    keys.forEach(function (k) {
      var im = new Image();
      im.onload = function () { out[k] = im; if (--left === 0) cb(out); };
      im.onerror = function () { console.error('image failed: ' + k); };
      im.src = map[k];
    });
  }

  function texture(gl, img, linear) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    var f = linear === false ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function context(canvas) {
    var gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false
    });
    if (!gl) { console.error('WebGL2 unavailable'); return null; }
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); }, false);
    canvas.addEventListener('webglcontextrestored', function () { location.reload(); }, false);
    return gl;
  }

  // frame(t, dt): t = animation clock in seconds (double; starts at ?t=), dt = seconds since last drawn frame (clamped)
  function run(canvas, frame, onResize) {
    var bench = q.has('bench'), benchN = 0;
    var interval = 1000 / fps, raf = 0, last = -1, due = 0, clock = t0, dirty = true;
    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (now < due - 1) return;
      var dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      due += interval;
      if (due < now - interval) due = now + interval;   // steady cadence, no catch-up bursts
      if (!frozen) clock += dt;
      if (sizeCanvas(canvas) || dirty) { dirty = false; if (onResize) onResize(canvas.width, canvas.height); }
      frame(clock, dt);
      if (bench && ++benchN === 5) {          // testing aid (?bench): time N (default 200) back-to-back frames, GPU-synced
        var g = canvas.getContext('webgl2'), px = new Uint8Array(4), b0 = performance.now();
        var nb = parseInt(q.get('bench'), 10) || 200;
        for (var i = 0; i < nb; i++) frame(clock, 1 / 30);
        g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
        var ri = g.getExtension('WEBGL_debug_renderer_info');
        console.log('bench: ' + ((performance.now() - b0) / nb).toFixed(2) + ' ms/frame at ' + canvas.width + 'x' + canvas.height + ' on ' + (ri ? g.getParameter(ri.UNMASKED_RENDERER_WEBGL) : '?'));
      }
    }
    function start() { if (!raf && !document.hidden) { last = -1; due = 0; raf = requestAnimationFrame(tick); } }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    window.addEventListener('resize', function () { dirty = true; });
    start();
  }

  // deterministic hash helpers (JS side)
  function hash(n) { n = Math.imul((n | 0) ^ 0x9E3779B9, 0x85EBCA6B); n ^= n >>> 13; n = Math.imul(n, 0xC2B2AE35); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
  function hash2(a, b) { return hash(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)); }

  return { fps: fps, t0: t0, q: q, cover: cover, program: program, loadImages: loadImages, texture: texture,
           context: context, run: run, hash: hash, hash2: hash2, sizeCanvas: sizeCanvas, VS: VS };
})();
