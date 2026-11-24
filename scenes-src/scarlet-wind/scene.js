// Scarlet Wind: a painting set moving, one WebGL2 fragment shader. The armoured figure stands dead still; the wind
// (from the right) moves everything around her. Everything is a function of the time alone and periodic in L:
// every wave, drift and spark runs a whole number of times per loop.
//   picture  the painting (picture.jpg, 1920 x 1080). On a phone a taller picture is used instead (tall.jpg: the
//            same painting with more canopy above it, see tools/tall.py); all positions below are in the
//            painting's own pixels, y down, so rows above the painting are negative.
//   masks    masks.png: R = the figure, G = her streaming hair (0 at the shoulder .. 1 at the tips),
//            B = the cape's loose edge
//   marks    marks.png: R = the fur collar, G = the painted ring of sparks, B = the embers by the blade
//   Scene.run({ L, ring: [cx, cy, rx, ry], root: [x, y], landscape, portrait })
//     ring: the painted ring's ellipse; root: where the hair streams from;
//     layout: { picture, org: [x, y], size: [w, h], x, w, seam }: the picture file, where its top left corner is
//     and how large it is in the painting's pixels, then the view: the painting's column `x` is at the middle of
//     the screen and `w` of its pixels span the screen's width (the view always stands on the painting's bottom
//     edge); seam: mist over the painting's top edge, where the taller picture joins it.
//   ?t=<seconds> freezes time; ?wind=<0..1.5> scales how hard the hair and cape are blown (1 = as designed)
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const frozen = qs.has('t') ? parseFloat(qs.get('t')) : null;
  const wind = qs.has('wind') ? parseFloat(qs.get('wind')) : 1;

  const VS = `#version 300 es
void main() { gl_Position = vec4(vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0, 0.0, 1.0); }`;

  const FS = `#version 300 es
precision highp float;
uniform sampler2D uPic, uMasks, uMarks, uNoise;
uniform vec2 uRes;
uniform vec3 uView;      // the painting's pixel at the screen's top left corner (x, y), and its pixels per screen pixel
uniform vec2 uOrg, uSize; // the picture's top left corner and size, in the painting's pixels
uniform float uT;        // 0..1 over the loop
uniform float uWind;     // how hard the hair and cape are blown
uniform float uSeam;     // mist over the painting's top edge (0 or 1)
uniform vec4 uRing;      // the ring's ellipse: centre x, y, radii x, y
uniform vec2 uRoot;      // where the hair streams from
out vec4 o;
const float TAU = 6.28318530718;
const vec2 PIC = vec2(1920.0, 1080.0);

vec4 nz(vec2 q) { return texture(uNoise, q); }
float hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
vec3 pic(vec2 P) { return texture(uPic, (P - uOrg) / uSize).rgb; }
vec3 air(vec2 P) { return textureLod(uPic, (P - uOrg) / uSize, 6.0).rgb; }   // the colour of the mist around P
float inside(vec2 P) { return step(0.0, P.y) * step(0.0, P.x) * step(P.x, PIC.x); }
vec3 masks(vec2 P) { return texture(uMasks, P / PIC).rgb * inside(P); }
vec3 marks(vec2 P) { return texture(uMarks, P / PIC).rgb * inside(P); }

// how far the wind has moved the picture's point P (pixels), and how the light on it changed
vec2 blown(vec2 P, out float lit) {
  vec3 m = masks(P);
  vec2 D = vec2(0.0);
  lit = 1.0;
  if (m.g > 0.003) {
    // hair: waves run out along the strands from her shoulder to the tips, never back; a slow lift and fall,
    // quicker ripples on top, all larger toward the tips and in gusts. Strands at different angles are out of step
    vec2 v = P - uRoot;
    float rad = length(v);
    vec2 d = v / rad, n = vec2(-d.y, d.x);
    float ph = TAU * 1.3 * nz(vec2(atan(v.y, v.x) * 0.9, 0.31)).g;
    float gust = 0.55 + 0.9 * nz(vec2(0.13 + 2.0 * uT, 0.71 + rad / 2600.0)).r;
    float a3 = TAU * (rad / 640.0 - 6.0 * uT) + 0.6 * ph;
    float a1 = TAU * (rad / 210.0 - 23.0 * uT) + ph;
    float a2 = TAU * (rad / 120.0 - 37.0 * uT) + 2.1 * ph + 1.7;
    float k = m.g * gust * uWind;
    D += k * (n * (10.0 * sin(a3) + 5.0 * sin(a1) + 2.5 * sin(a2)) + d * 2.5 * sin(a3 + 1.1));
    lit += 0.10 * k * (cos(a1) + 0.6 * cos(a2));
  }
  if (m.b > 0.003) {
    // the cape's loose edge: waves run down it to the hem
    float gust = 0.5 + 1.0 * nz(vec2(0.57 + 3.0 * uT, 0.23)).g;
    float b1 = TAU * (P.y / 190.0 - 17.0 * uT), b2 = TAU * (P.y / 95.0 - 29.0 * uT) + 1.3;
    D += m.b * gust * uWind * (vec2(4.0, 1.0) * sin(b1) + vec2(2.0, 0.6) * sin(b2));
    lit += 0.05 * m.b * gust * uWind * cos(b1);
  }
  float fur = marks(P).r;
  if (fur > 0.003) {
    // the fur collar shivers
    vec2 s = vec2(nz(P / 70.0 + vec2(9.0 * uT, 0.0)).r, nz(P / 70.0 + vec2(0.37, 7.0 * uT)).g) - 0.5;
    D += fur * uWind * 3.2 * s;
  }
  return D;
}

// mist rolling left with the wind, thicker low down: its opacity. q in painting heights
float mist(vec2 q, float seed) {
  float f = 0.60 * nz(q * 0.55 + vec2(2.0 * uT, 0.0) + seed).r + 0.40 * nz(q * 1.15 + vec2(3.0 * uT, uT) + 1.7 * seed).g;
  return smoothstep(0.42, 0.80, f);
}

// the ring of sparks, alive: sparks ride round the painted ring (clockwise, once per loop; a second, fainter
// band twice), a few shed outward as they go, and all of them come and go with the bright stretches of the ring
float stretch(float th) { return smoothstep(0.38, 0.72, nz(vec2((th - uT) * 4.0, 0.3)).r); }
vec3 ring(vec2 P) {
  vec2 e = (P - uRing.xy) / uRing.zw;
  float rr = length(e);
  if (abs(rr - 1.0) > 0.24) return vec3(0.0);
  float th = atan(e.y, e.x) / TAU + 0.5, R = 0.5 * (uRing.z + uRing.w);
  float zone = 0.30 + 0.95 * stretch(th);
  vec3 c = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    float fj = float(j);
    float N = j == 0 ? 120.0 : j == 1 ? 190.0 : j == 2 ? 70.0 : 150.0;
    float u = mod((th - (j == 2 ? 2.0 : 1.0) * uT) * N, N), i0 = floor(u), f = u - i0;
    for (int s = -1; s <= 1; s++) {
      float i = mod(i0 + float(s), N);
      float a = hash(i + 31.0 * fj), b = hash(i * 1.7 + 57.0 + 13.0 * fj);
      float g = hash(i * 2.3 + 91.0 + 7.0 * fj), h = hash(i * 3.1 + 17.0 + 5.0 * fj);
      float life = fract(g + (2.0 + floor(3.0 * h)) * uT);           // each spark's own cycle
      float off = (b - 0.5) * abs(b - 0.5) * 0.22;                    // most of them close to the ring
      float tw = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(TAU * life), 2.0);
      if (j == 3) { off += 0.015 + 0.15 * life * (0.4 + h); tw = smoothstep(0.0, 0.1, life) * (1.0 - life) * (1.0 - life); }
      float dx = (f - float(s) - a) / N * TAU * R, dy = (rr - 1.0 - off) * R;
      float sz = j == 2 ? 2.6 : 1.1 + 1.3 * h;
      c += exp(-(0.3 * dx * dx + dy * dy) / (sz * sz)) * tw * (j == 2 ? 0.45 : 1.0) * mix(vec3(1.0, 0.20, 0.11), vec3(1.0, 0.52, 0.34), h * h);
    }
  }
  return c * zone;
}

// embers lifting off the glowing ground by the blade, carried up and to the left
vec3 embers(vec2 P) {
  if (P.y < 480.0 || P.x > 980.0) return vec3(0.0);
  vec3 c = vec3(0.0);
  for (int i = 0; i < 36; i++) {
    float fi = float(i);
    float a = hash(fi * 1.31 + 2.0), b = hash(fi * 2.17 + 5.0), d = hash(fi * 3.71 + 9.0), e = hash(fi * 5.3 + 1.0);
    float age = fract((2.0 + floor(3.0 * e)) * uT + a);
    vec2 pos = vec2(270.0 + 430.0 * b, 1070.0 - 45.0 * d - 43.0 * b);
    pos += age * vec2(-130.0 - 190.0 * d, -210.0 - 250.0 * a);
    pos += 18.0 * age * vec2(sin(TAU * (2.0 * age + b)), cos(TAU * (3.0 * age + d)));
    vec2 q = P - pos;
    float sz = 1.2 + 1.3 * e;
    float br = smoothstep(0.0, 0.06, age) * pow(1.0 - age, 1.6) * (0.6 + 0.4 * sin(TAU * (9.0 * age + e)));
    c += exp(-dot(q, q) / (sz * sz)) * br * mix(vec3(1.0, 0.62, 0.20), vec3(1.0, 0.28, 0.08), age);
  }
  return c;
}

// dust carried left: one mote in some of the cells of a grid that slides past (the grid repeats every M cells, and
// slides a whole number of repeats per loop)
float dust(vec2 P, float cell, float M, float sp, float seed) {
  vec2 g = (P + vec2(sp * M * cell * uT, 0.0)) / cell;
  vec2 i = mod(floor(g), M), f = fract(g);
  float a = hash(i.x + 37.0 * i.y + seed), b = hash(i.x * 1.3 + 11.0 * i.y + 3.0 + seed), c = hash(i.x * 2.1 + 5.3 * i.y + 7.0 + seed);
  vec2 pos = 0.15 + 0.7 * vec2(a, b);
  pos.y += 0.12 * sin(TAU * (3.0 * uT + c));
  vec2 q = (f - pos) * cell;
  return exp(-dot(q, q) / 1.6) * step(0.5, c) * (2.0 * c - 1.0);
}

// leaves tumbling across on the wind, right to left: three behind her (layer 0), three in front (layer 1, larger)
vec4 leaves(vec2 P, float layer) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i) + 3.0 * layer;
    float a = hash(fi * 1.9 + 0.7), b = hash(fi * 2.9 + 3.1), c = hash(fi * 4.3 + 5.9), d = hash(fi * 6.1 + 8.3);
    float age = fract((1.0 + floor(2.0 * d)) * uT + a);
    float size = mix(12.0, 19.0, c) * (1.0 + 0.7 * layer);
    vec2 pos = vec2(2400.0 - 3200.0 * age, 120.0 + 760.0 * b + 190.0 * age + 55.0 * sin(TAU * (2.0 * age + c)));
    vec2 q = P - pos;
    if (dot(q, q) > 1.3 * size * size) continue;
    float ang = TAU * (3.0 * age + c), flip = cos(TAU * (4.0 * age + d)), thin = max(abs(flip), 0.18);
    q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
    float x = q.x / size;
    float edge = (0.42 * size * (1.0 - x * x) - abs(q.y) / thin) * thin;         // a pointed oval, seen more or less edge on
    float al = smoothstep(-0.9, 0.9, edge) * 0.92;
    vec3 col = mix(vec3(0.21, 0.25, 0.12), vec3(0.36, 0.31, 0.14), step(0.5, c)) * (0.5 + 0.5 * abs(flip));
    col *= 1.0 - 0.3 * exp(-q.y * q.y / (thin * thin * 1.5));                    // the midrib
    acc += (1.0 - acc.a) * vec4(col * al, al);
  }
  return acc;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 P = uView.xy + p * uView.z;
  vec2 q = P / PIC.y;
  float lit;
  vec2 S = P - blown(P, lit);                                // where this point of the screen comes from in the picture
  vec3 col = pic(S) * lit;
  float fig = masks(S).r;
  vec3 mk = marks(S);

  // the painted sparks of the ring brighten as a bright stretch of the ring comes round, and dim after it
  vec2 e = (P - uRing.xy) / uRing.zw;
  float th = atan(e.y, e.x) / TAU + 0.5;
  float tw = nz(P / 37.0 + vec2(0.0, 11.0 * uT)).b;
  col *= 1.0 + mk.g * (1.7 * stretch(th) * (0.6 + 0.8 * tw) - 0.42);

  // the embers on the ground breathe and flicker
  float glow = textureLod(uMarks, S / PIC, 2.5).b * inside(S);
  float fl = nz(vec2(P.x / 300.0 + 5.0 * uT, P.y / 300.0 - 2.0 * uT)).r;
  col *= 1.0 + glow * (0.9 * sin(TAU * 4.0 * uT) + 2.6 * (fl - 0.45));

  // mist and leaves behind her
  vec3 fogc = mix(air(P) * 1.5, vec3(0.34, 0.33, 0.32), 0.45);
  float low = smoothstep(250.0, 1080.0, P.y);
  col = mix(col, fogc, mist(q, 0.0) * (0.10 + 0.26 * low) * (1.0 - fig));
  vec4 lf = leaves(P, 0.0);
  col = mix(col, lf.rgb / max(lf.a, 1e-4), lf.a * (1.0 - fig));

  // what the wind carries in front of her
  col += 0.9 * ring(P);
  col += 1.2 * embers(P);
  col += vec3(0.50, 0.47, 0.43) * 0.5 * (dust(P, 90.0, 16.0, 1.0, 0.0) + dust(P, 150.0, 12.0, 1.0, 40.0));
  lf = leaves(P, 1.0);
  col = mix(col, lf.rgb / max(lf.a, 1e-4), lf.a);
  col = mix(col, fogc, mist(q * 0.8 + 0.4, 0.37) * (0.03 + 0.15 * smoothstep(650.0, 1080.0, P.y)));

  // where the taller picture joins the painting: mist over the join, drifting
  float seam = exp(-pow(P.y / 110.0, 2.0)) * (0.55 + 0.45 * mist(q * 1.3 + 0.2, 0.61));
  col = mix(col, mix(air(P) * 1.25, vec3(0.20, 0.195, 0.19), 0.5), uSeam * seam * 0.85);

  vec2 vg = p / uRes - 0.5;
  col *= 1.0 - 0.45 * dot(vg, vg);
  col += (nz(p / 1024.0 + 0.123).a - 0.5) / 255.0;            // a still dither against banding in the dark mist
  o = vec4(col, 1.0);
}`;

  function run(opt) {
    const L = opt.L;
    const cv = document.getElementById('c');
    const gl = cv.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    function sh(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); throw new Error('shader'); }
      return s;
    }
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(pr)); throw new Error('link'); }
    gl.useProgram(pr);
    const U = n => gl.getUniformLocation(pr, n);

    // texture units: 0 landscape picture, 1 portrait picture, 2 masks, 3 marks, 4 noise
    const files = [[opt.landscape.picture, false], [opt.portrait.picture, false], ['masks.png', false], ['marks.png', false],
                   ['noise.png', true]];
    let left = files.length;
    files.forEach(([file, repeat], i) => {
      const im = new Image();
      im.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        if (!repeat) gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, repeat ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        if (--left === 0) { window.sceneReady = true; requestAnimationFrame(frame); }
      };
      im.onerror = () => console.error('missing ' + file);
      im.src = file;
    });
    gl.uniform1i(U('uMasks'), 2);
    gl.uniform1i(U('uMarks'), 3);
    gl.uniform1i(U('uNoise'), 4);
    gl.uniform4f(U('uRing'), ...opt.ring);
    gl.uniform2f(U('uRoot'), ...opt.root);
    gl.uniform1f(U('uWind'), wind);

    function frame(now) {
      if (frozen === null) requestAnimationFrame(frame);      // a frozen picture is drawn once
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      gl.viewport(0, 0, W, H);
      const t = frozen !== null ? frozen : now / 1000;
      const tall = H > W, lay = tall ? opt.portrait : opt.landscape;
      const k = lay.w / W;
      gl.uniform1i(U('uPic'), tall ? 1 : 0);
      gl.uniform2f(U('uRes'), W, H);
      gl.uniform3f(U('uView'), lay.x - lay.w / 2, 1080 - H * k, k);
      gl.uniform2f(U('uOrg'), lay.org[0], lay.org[1]);
      gl.uniform2f(U('uSize'), lay.size[0], lay.size[1]);
      gl.uniform1f(U('uSeam'), lay.seam ? 1 : 0);
      gl.uniform1f(U('uT'), ((t / L) % 1 + 1) % 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      window.sceneDrawn = true;
    }
  }
  window.Scene = { run };
})();
