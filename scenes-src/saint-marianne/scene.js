// Saint Marianne: a painted devotional picture set moving, one WebGL2 fragment shader. Everything is a function of
// the time alone and periodic in L: the smoke is the plate picture carried along a fixed wind field in three
// overlapping phases, each fading in and out as it resets (held still near the sunburst, so its rays stay straight);
// the rays' twinkle, the soot, the thin smoke in front and the cloth's waves run a whole number of times per loop.
//   plate   the sunburst and the smoke behind her, one picture per layout (it has no statue in it)
//   statue  the figure cut out of the picture (statue.png, RGBA, the whole phone picture)
//   vest    vest.png: R = where the cloth is, G = how free it is (0 on her chest, 1 at the tips of the flying cloth).
//           motion.png is its motion, an atlas made by tools/flowatlas.py from short clips of the cloth in wind:
//           per frame, where each point came from in the still and how its shading changed
//   Scene.run({ L, smoke, soot, landscape, portrait, motion })
//     smoke: how many times the smoke's phases turn over per loop; soot: how much dark smoke rolls through;
//     layout: { plate, h, x, sun: [x, y] }; motion: the atlas's numbers and how it is played (see index.html).
//     The waves' counts per loop in the shader are chosen for L = 24.
//   ?t=<seconds> freezes time
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const frozen = qs.has('t') ? parseFloat(qs.get('t')) : null;

  const VS = `#version 300 es
void main() { gl_Position = vec4(vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0, 0.0, 1.0); }`;

  const FS = `#version 300 es
precision highp float;
uniform sampler2D uPlate, uStatue, uVest, uNoise, uFlow;
uniform vec2 uRes;
uniform vec4 uSt;        // the statue picture on the screen, pixels from the top left: x, y, width, height
uniform float uT;        // 0..1 over the loop
uniform float CYC;       // smoke phases per loop
uniform float uSoot;     // how much dark smoke rolls through (0..1)
uniform vec2 uSun;       // the sunburst's centre on the screen (0..1)
uniform vec4 uCrop;      // the clip's frame within the statue picture (0..1): x, y, width, height
uniform vec4 uGrid;      // motion atlas: columns, rows, frames per clip, range
uniform float uClips;    // clips in it
uniform vec4 uGain;      // how much of each clip's motion to apply (1 = as filmed)
uniform float uFlutter;  // how hard the cloth flaps on top of it
uniform vec3 uPlay;      // first frame used of each clip, overlap (share of a slot), times round the clips per loop
uniform vec2 uPic;       // the statue picture's size, pixels
uniform vec2 uCell;      // one frame of it, texels
out vec4 o;
const float TAU = 6.28318530718;
const float AMP = 0.11;  // how far a phase carries the smoke, in screen heights

vec4 nz(vec2 q) { return texture(uNoise, q); }

// the wind the smoke rides, fixed in time: upward, curling. q in screen heights, y down
vec2 wind(vec2 q) {
  const float e = 0.012;
  vec2 s = q * 0.42 + vec2(0.31, 0.07);
  float a = nz(s + vec2(e, 0.0)).r - nz(s - vec2(e, 0.0)).r;
  float b = nz(s + vec2(0.0, e)).r - nz(s - vec2(0.0, e)).r;
  vec2 curl = vec2(b, -a) / (2.0 * e);
  return vec2(0.10, -1.0) + 0.16 * curl;
}

vec3 smoke(vec2 p) {
  vec2 uv = p / uRes, q = p / uRes.y;
  vec2 sd = (uv - uSun) * vec2(uRes.x / uRes.y, 1.0);        // from the sunburst's centre, in screen heights
  float r = length(sd), ang = atan(sd.y, sd.x) / TAU;
  // the smoke is carried by the wind, but not where the rays are: they must stay straight
  vec2 v = wind(q) * vec2(uRes.y / uRes.x, 1.0) * smoothstep(0.06, 0.30, r);
  vec3 c = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float ph = fract(uT * CYC + float(i) / 3.0);
    float w = (1.0 - cos(TAU * ph)) / 3.0;
    c += w * texture(uPlate, uv - v * (ph - 0.5) * AMP).rgb;
  }
  vec3 soft = textureLod(uPlate, uv, 5.0).rgb;
  c = soft + (c - soft) * (1.0 + 0.22 * smoothstep(0.06, 0.30, r));
  float d = (nz(q * 3.0 + vec2(0.13, uT)).g - 0.5) + 0.6 * (nz(q * 6.0 + vec2(0.71, 2.0 * uT)).b - 0.5);
  c *= 1.0 + 0.10 * d;
  // the rays twinkle: each brightens and dims in its own time, and the heart of the light breathes
  float near = 1.0 - smoothstep(0.03, 0.36, r);
  float tw = nz(vec2(ang * 6.0, 2.0 * uT + 0.2 * r)).r * nz(vec2(ang * 13.0 + 0.3, -3.0 * uT)).g;
  c *= 1.0 + 1.3 * (tw - 0.22) * near;
  float st = pow(nz(vec2(ang * 9.0 + 0.6, 3.0 * uT)).b * nz(vec2(ang * 23.0, -2.0 * uT + 0.5)).r, 2.0);
  c += vec3(1.0, 0.84, 0.50) * (1.4 * st * near * near + 0.05 * sin(TAU * 3.0 * uT) * (1.0 - smoothstep(0.0, 0.22, r)));
  return c;
}

// soot: dark smoke rolling up and across with the wind, in front of the coloured smoke but not over the light
float soot(vec2 p) {
  vec2 q = p / uRes.y;
  vec2 sd = (p / uRes - uSun) * vec2(uRes.x / uRes.y, 1.0);
  float f = 0.6 * nz(q * 1.6 + vec2(uT, uT) + 0.21).a + 0.4 * nz(q * 3.2 + vec2(2.0 * uT, 2.0 * uT) + 0.63).r;
  return smoothstep(0.46, 0.80, f) * smoothstep(0.07, 0.36, length(sd));
}

// thin smoke drifting in front, thicker low down: returns its opacity
float veil(vec2 p) {
  vec2 q = p / uRes.y;
  float f = 0.62 * nz(q * 1.1 + vec2(-uT, uT)).r + 0.38 * nz(q * 2.3 + vec2(-2.0 * uT, 3.0 * uT) + 0.37).a;
  float low = smoothstep(0.30, 1.0, p.y / uRes.y);
  return smoothstep(0.45, 0.82, f) * (0.04 + 0.20 * low);
}

// the vest's motion, taken from a filmed-looking clip of it: for a point of the clip (0..1) and a frame, where that
// point came from in the still (rg) and how the cloth's shading changed there (b)
vec3 motion(vec2 c, float i) {
  vec2 cell = vec2(mod(i, uGrid.x), floor(i / uGrid.x));
  vec2 cc = clamp(c, 0.5 / uCell, 1.0 - 0.5 / uCell);
  return texture(uFlow, (cell + cc) / uGrid.xy).rgb;
}

// a clip at x = 0..1 through its window (its first frames, still starting up from the still, are skipped)
vec3 clipAt(vec2 c, float clip, float x) {
  float f = uPlay.x + clamp(x, 0.0, 1.0) * (uGrid.z - 1.0 - uPlay.x), i = min(floor(f), uGrid.z - 2.0);
  return mix(motion(c, clip * uGrid.z + i), motion(c, clip * uGrid.z + i + 1.0), f - i);
}

vec4 statue(vec2 p, out float cloth) {
  cloth = 0.0;
  vec2 s = (p - uSt.xy) / uSt.zw;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return vec4(0.0);
  vec2 c = (s - uCrop.xy) / uCrop.zw;
  vec2 fl = vec2(0.0);
  float lit = 1.0;
  float free = texture(uVest, s).g;                       // 0 on her chest .. 1 at the tips of the flying cloth
  if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0) {
    // the clips are played one after another, forward only, uPlay.z times round per loop; each runs on a little
    // past its slot, and the next one fades in over it (motion blended with motion, never a picture with a picture)
    float u = fract(uT * uPlay.z) * uClips, k = min(floor(u), uClips - 1.0), fr = u - k;
    float kp = mod(k - 1.0 + uClips, uClips);
    vec3 a = clipAt(c, k, fr / (1.0 + uPlay.y));
    vec3 bb = clipAt(c, kp, (fr + 1.0) / (1.0 + uPlay.y));
    float w = smoothstep(0.0, uPlay.y, fr);
    float g = mix(uGain[int(kp)], uGain[int(k)], w) * (0.35 + 0.65 * free);
    vec3 m3 = mix(bb, a, w);
    fl = (m3.rg - 0.5) * 2.0 * uGrid.w * uCrop.zw * g;
    lit = 1.0 + (m3.b * 2.0 - 1.0) * min(g, 1.5);
  }
  // flapping: waves run along the cloth with the wind (from the right, down the tails), all at about the same
  // speed, small on her chest and large at the free ends, in gusts; they lift the cloth across its length and
  // their slopes catch the light. P is in pixels of the statue picture
  vec2 P = s * uPic;
  float gust = 0.55 + 0.9 * nz(P / 1500.0 + vec2(5.0, 2.0) * uT).r;
  float along = P.x - 0.35 * P.y;
  float a1 = TAU * (along / 260.0 + 60.0 * uT);
  float a2 = TAU * (along / 150.0 + 89.0 * uT) + 1.7;
  float a3 = TAU * ((P.x - 0.1 * P.y) / 420.0 + 37.0 * uT) + 0.6;
  float kf = uFlutter * free * gust;
  vec2 d = kf * (vec2(4.0, 16.0) * sin(a1) + vec2(-2.0, 8.0) * sin(a2) + vec2(5.0, 14.0) * sin(a3)) / uPic;
  float there = texture(uVest, s + fl - d).r;
  vec4 col = mix(texture(uStatue, s + fl), texture(uStatue, s + fl - d), smoothstep(0.3, 0.7, there));
  cloth = max(there, texture(uVest, s + fl).r);
  col.rgb *= mix(1.0, lit * (1.0 + there * kf * (0.22 * cos(a1) + 0.12 * cos(a2) + 0.14 * cos(a3))), cloth);
  return col;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = p / uRes;
  vec3 col = smoke(p);
  vec3 air = textureLod(uPlate, uv, 6.0).rgb;             // the colour of the smoke around this point
  col = mix(col, 0.05 + 0.30 * air, uSoot * soot(p));
  float cloth;
  vec4 st = statue(p, cloth);
  // the bronze takes a little of the smoke's colour, and sinks into it toward the bottom
  vec3 body = mix(st.rgb, air, 0.08 * smoothstep(0.7, 1.0, uv.y));
  col = mix(col, body, st.a);
  float v = veil(p);
  col = mix(col, air * 0.78 + 0.02, v);
  vec2 vg = uv - 0.5;
  col *= 1.0 - 0.55 * dot(vg, vg);                         // the corners fall away into the dark
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

    // texture units: 0 landscape plate, 1 portrait plate, 2 statue, 3 vest, 4 noise, 5 the vest's motion
    const files = [[opt.landscape.plate, false], [opt.portrait.plate, false], ['statue.png', false], ['vest.png', false],
                   ['noise.png', true], ['motion.png', null]];
    const size = [];
    let left = files.length;
    files.forEach(([file, repeat], i) => {
      const im = new Image();
      im.onload = () => {
        size[i] = [im.naturalWidth, im.naturalHeight];
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        if (repeat === false) gl.generateMipmap(gl.TEXTURE_2D);   // pictures only: the noise is smooth, the atlas is cells
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, repeat === false ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        if (--left === 0) { window.sceneReady = true; requestAnimationFrame(frame); }
      };
      im.onerror = () => console.error('missing ' + file);
      im.src = file;
    });
    gl.uniform1i(U('uStatue'), 2);
    gl.uniform1i(U('uVest'), 3);
    gl.uniform1i(U('uNoise'), 4);
    gl.uniform1i(U('uFlow'), 5);
    gl.uniform1f(U('CYC'), opt.smoke);
    gl.uniform1f(U('uSoot'), opt.soot || 0);
    const M = opt.motion;
    gl.uniform4f(U('uCrop'), M.crop[0], M.crop[1], M.crop[2], M.crop[3]);
    gl.uniform4f(U('uGrid'), M.cols, M.rows, M.frames, M.range);
    gl.uniform2f(U('uCell'), M.cell[0], M.cell[1]);
    gl.uniform1f(U('uClips'), M.clips);
    gl.uniform4f(U('uGain'), ...[0, 1, 2, 3].map(i => M.gain[i] || 1));
    gl.uniform1f(U('uFlutter'), M.flutter || 0);
    gl.uniform3f(U('uPlay'), M.first, M.overlap, M.rounds);

    function frame(now) {
      if (frozen === null) requestAnimationFrame(frame);      // a frozen picture is drawn once
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      gl.viewport(0, 0, W, H);
      const t = frozen !== null ? frozen : now / 1000;
      const tall = H > W, lay = tall ? opt.portrait : opt.landscape;
      const sh = H * lay.h, sw = sh * size[2][0] / size[2][1];
      gl.uniform1i(U('uPlate'), tall ? 1 : 0);
      gl.uniform2f(U('uRes'), W, H);
      gl.uniform2f(U('uSun'), lay.sun[0], lay.sun[1]);
      gl.uniform2f(U('uPic'), size[2][0], size[2][1]);
      gl.uniform4f(U('uSt'), W * lay.x - sw / 2, H - sh, sw, sh);
      gl.uniform1f(U('uT'), ((t / L) % 1 + 1) % 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      window.sceneDrawn = true;
    }
  }
  window.Scene = { run };
})();
