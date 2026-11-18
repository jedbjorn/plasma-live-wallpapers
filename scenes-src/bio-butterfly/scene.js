// Draws the scene: the picture (plate), her head as a mesh that can turn, the butterfly, and the light they
// give off. WebGL2, no dependencies. Scene.run({ jaw, landscape, portrait })
//   jaw               [from, to]: two points of her head (picture x, y, depth) between which the far cheek and jaw
//                     run in a straight line while she is turned
//   landscape, portrait   { left, route }: left = first picture column shown (the picture always stands on the
//                     bottom edge and is scaled to fill the width from there); route = the butterfly's way
//                     points (see fly.js)
// ?t=<seconds> freezes time. Everything is periodic in Story.L.
(function () {
  const SRC = [1920, 1080], HEAD = [1330, 44, 1790, 444], HAND = [1088, 416, 1288, 536];
  const { L, T, s3, ramp, clamp, lerp } = Story;
  const TAU = Math.PI * 2, RAD = Math.PI / 180;
  const qs = new URLSearchParams(location.search);
  const frozen = qs.has('t') ? parseFloat(qs.get('t')) : null;

  const CEN = [1525, 285];                 // middle of her skull: the axis her head turns about goes through it
  const LEAN = 15 * RAD;                   // her head leans this much towards the butterfly, as painted
  const NECK = [1585, 440];                // the base of her neck: the head tilts about it
  const ELBOW = [1345, 625];
  const EYES = [[1512, 293, 1.0], [1421, 320, 0.72]];
  const BODYZ = 12;                        // the neck and shoulders, for hiding the hair that swings behind them

  const VS_ART = `#version 300 es
in vec2 aP; uniform vec4 uView; uniform float uZ; out vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP*uView.xy + uView.zw, uZ, 1.0); }`;

  const FS_PLATE = `#version 300 es
precision highp float;
uniform sampler2D uPlate, uHand;
uniform vec4 uHandBox, uFly;            // uFly: x, y, strength, reach
uniform vec2 uHandMix;                  // the butterfly's light on the hand, its shadow on the finger
uniform float uBreath, uArm, uRed;
in vec2 vP; out vec4 o;
const vec2 SRC = vec2(${SRC[0]}.0, ${SRC[1]}.0), ELBOW = vec2(${ELBOW[0]}.0, ${ELBOW[1]}.0);
void main(){
  vec2 p = vP;
  // her chest rises and falls; the raised arm follows a little
  p.y += uBreath * smoothstep(820.0, 640.0, p.y) * mix(0.35, 1.0, smoothstep(1250.0, 1420.0, p.x));
  // the forearm turns about the elbow
  float w = (1.0 - smoothstep(1300.0, 1385.0, p.x)) * (1.0 - smoothstep(660.0, 700.0, p.y));
  float a = -uArm * w; vec2 d = p - ELBOW;
  p = ELBOW + vec2(d.x*cos(a) - d.y*sin(a), d.x*sin(a) + d.y*cos(a));
  vec3 c = texture(uPlate, p/SRC).rgb;
  vec2 h = (p - uHandBox.xy)/(uHandBox.zw - uHandBox.xy);
  if (h.x > 0.0 && h.x < 1.0 && h.y > 0.0 && h.y < 1.0) {
    float e = smoothstep(0.0, 0.05, h.x)*smoothstep(1.0, 0.95, h.x)*smoothstep(0.0, 0.06, h.y)*smoothstep(1.0, 0.94, h.y);
    vec3 lit = texture(uHand, vec2(h.x, h.y*0.5)).rgb, shade = texture(uHand, vec2(h.x, 0.5 + h.y*0.5)).rgb;
    c = mix(c, mix(lit, shade, uHandMix.y), uHandMix.x*e);
  }
  if (max(c.r, max(c.g, c.b)) < 0.006) discard;
  // the glass of red: a slow pulse
  float red = clamp((c.r - max(c.g, c.b))*3.0, 0.0, 1.0) * step(1650.0, vP.x) * step(740.0, vP.y);
  c *= 1.0 + uRed*red;
  // the butterfly's light
  vec2 dl = (vP - uFly.xy)/uFly.w;
  c += (c + 0.015) * vec3(0.22, 0.78, 1.0) * uFly.z / (1.0 + dot(dl, dl));
  o = vec4(c, 1.0);
}`;

  const VS_HEAD = `#version 300 es
in vec3 aP; in float aSway;
uniform mat4 uM; uniform vec4 uView; uniform vec3 uSway;
out vec2 vUV, vArt;
const vec4 HEAD = vec4(${HEAD[0]}.0, ${HEAD[1]}.0, ${HEAD[2] - HEAD[0]}.0, ${HEAD[3] - HEAD[1]}.0);
void main(){
  vec3 p = aP;
  p.x += aSway * (uSway.x*sin(6.2831853*(p.y/150.0 + uSway.y)) + uSway.z);
  vec4 q = uM * vec4(p, 1.0);
  vUV = (aP.xy - HEAD.xy)/HEAD.zw; vArt = q.xy;
  gl_Position = vec4(q.xy*uView.xy + uView.zw, -q.z/600.0, 1.0);
}`;
  const FS_HEAD = `#version 300 es
precision highp float;
uniform sampler2D uHead, uHeadB, uBand;
uniform vec4 uFly;
uniform vec3 uEye;                      // steady glow, flare, how far she has turned
uniform float uDark;                    // how much of the far cheek's dark is on (0 as painted .. 1 facing the viewer)
uniform vec4 uJaw;                      // the line her far cheek and jaw keep while she is turned: from, to (picture pixels)
uniform vec2 uTrim;                     // how far outside that line the cheek may still stand, how soft the line is
uniform vec4 uEyes;                     // the two eyes in the head box: x, y, x, y (0..1)
in vec2 vUV, vArt; out vec4 o;
const vec2 SIZE = vec2(${HEAD[2] - HEAD[0]}.0, ${HEAD[3] - HEAD[1]}.0);
void main(){
  // headB: her far cheek, which comes into view as she turns, growing out from the painted outline
  float th = 1.0 - uEye.z;
  vec3 band = texture(uBand, vUV).rgb;
  vec4 c = mix(texture(uHead, vUV), texture(uHeadB, vUV) * smoothstep(th - 0.35, th, band.r), smoothstep(0.0, 0.45, uEye.z));
  // her far cheek and jaw run straight from beside the eye to the chin: what stands outside that line goes
  vec2 ab = uJaw.zw - uJaw.xy, rel = vArt - uJaw.xy;
  float len = length(ab), along = dot(rel, ab)/(len*len);
  float out_ = dot(rel, vec2(-ab.y, ab.x))/len - uTrim.x - 4.8*clamp(along*(1.0 - along), 0.0, 0.25)   // (a hair's bow, not a ruler)
    - 0.45*min(uTrim.y, 6.0);                                           // the soft edge's middle sits on the line
  c *= 1.0 - band.b * smoothstep(-0.09, -0.03, along) * (1.0 - smoothstep(1.12, 1.18, along)) * smoothstep(-uTrim.y, 0.6, out_);
  if (c.a < 0.004) discard;
  c.rgb *= mix(1.0, band.g, uDark);     // that cheek comes out of the dark: black at its edge
  // her eyes: their light on the skin around them grows when she stares
  vec2 d1 = (vUV - uEyes.xy)*SIZE, d2 = (vUV - uEyes.zw)*SIZE;
  float g = exp(-dot(d1, d1)/1500.0) + 0.8*exp(-dot(d2, d2)/1000.0);
  float lum = dot(c.rgb, vec3(0.3, 0.6, 0.1));
  c.rgb += vec3(1.0, 0.93, 0.42) * g * (0.05 + 0.35*lum) * (uEye.x + 0.9*uEye.y) * c.a;
  c.rgb *= 1.0 - 0.07*uEye.y*(1.0 - min(g, 1.0));
  vec2 dl = (vArt - uFly.xy)/uFly.w;
  c.rgb += (c.rgb + 0.015*c.a) * vec3(0.22, 0.78, 1.0) * uFly.z / (1.0 + dot(dl, dl));
  o = c;
}`;

  const VS_FLY = `#version 300 es
in vec2 aP; in vec2 aUV; in float aKind; in vec4 aCol;
uniform vec4 uView; out vec2 vUV; out float vKind; out vec4 vCol;
void main(){ vUV = aUV; vKind = aKind; vCol = aCol; gl_Position = vec4(aP*uView.xy + uView.zw, 0.0, 1.0); }`;
  const FS_FLY = `#version 300 es
precision highp float;
uniform sampler2D uWing;
in vec2 vUV; in float vKind; in vec4 vCol; out vec4 o;
void main(){
  if (vKind < 0.5) {
    vec4 c = texture(uWing, vUV);
    o = vec4(c.rgb*vCol.rgb*1.06, c.a) * vCol.a;
  } else if (vKind < 1.5) {              // the body: slim behind, a thick chest, a small head
    float x = vUV.x;
    float prof = mix(0.42, 1.0, smoothstep(0.1, 0.62, x)) * (1.0 - 0.3*smoothstep(0.84, 0.93, x)*(1.0 - smoothstep(0.93, 1.0, x)));
    float a = (1.0 - smoothstep(prof - 0.3, prof, abs(vUV.y))) * smoothstep(0.0, 0.07, x) * smoothstep(1.0, 0.95, x);
    o = vec4(vCol.rgb*a, a) * vCol.a;
  } else {
    float a = 1.0 - smoothstep(0.3, 1.0, abs(vUV.y));
    o = vec4(vCol.rgb*a, a) * vCol.a;
  }
}`;

  const VS_TRI = `#version 300 es
in vec2 aP; out vec2 vUV; void main(){ vUV = aP*0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
  const FS_BLIT = `#version 300 es
precision highp float; uniform sampler2D uTex; in vec2 vUV; out vec4 o;
void main(){ o = texture(uTex, vUV); }`;
  // the right edge of the picture, where she is cut off, sinks into the dark
  const FS_FADE = `#version 300 es
precision highp float; uniform vec4 uInv; uniform float uRes; out vec4 o;
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes - gl_FragCoord.y)*uInv.xy + uInv.zw;
  float f = smoothstep(${SRC[0] + 5}.0, ${SRC[0] - 130}.0, p.x);
  o = vec4(vec3(f), 1.0);
}`;
  const VS_SPR = `#version 300 es
in vec2 aP; in vec2 aUV; in vec4 aCol; uniform vec4 uView; out vec2 vUV; out vec4 vCol;
void main(){ vUV = aUV; vCol = aCol; gl_Position = vec4(aP*uView.xy + uView.zw, 0.0, 1.0); }`;
  const FS_SPR = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol; out vec4 o;
void main(){
  float d = dot(vUV, vUV);
  float f = exp(-d*vCol.a) * max(1.0 - d, 0.0);
  o = vec4(vCol.rgb*f, 0.0);
}`;

  const load = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('cannot load ' + src)); im.src = src; });

  async function run(cfg) {
    document.documentElement.style.cssText = document.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:0;top:0;display:block';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) { document.body.textContent = 'WebGL2 not available'; return; }
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    const prog = (vs, fs, attribs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s) + '\n' + src);
        gl.attachShader(p, s);
      }
      attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
      const u = {};
      for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const inf = gl.getActiveUniform(p, i); u[inf.name] = gl.getUniformLocation(p, inf.name); }
      return { p, u };
    };
    const P = {
      plate: prog(VS_ART, FS_PLATE, ['aP']), head: prog(VS_HEAD, FS_HEAD, ['aP', 'aSway']),
      fly: prog(VS_FLY, FS_FLY, ['aP', 'aUV', 'aKind', 'aCol']), blit: prog(VS_TRI, FS_BLIT, ['aP']),
      fade: prog(VS_TRI, FS_FADE, ['aP']), spr: prog(VS_SPR, FS_SPR, ['aP', 'aUV', 'aCol']),
    };

    const [imPlate, imHand, imHead, imDepth, imWing, imHeadB, imBand] = await Promise.all(['plate.png', 'hand.png', 'head.png', 'depth.png', 'wing.png', 'headB.png', 'band.png'].map(load));
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const tex = (im, unit, mip) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (mip) {
        gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return t;
    };
    tex(imPlate, 0, true); tex(imHand, 1, false); tex(imHead, 2, true); tex(imWing, 3, true); tex(imHeadB, 6, true); tex(imBand, 7, false);

    // ---- geometry
    const vao = (data, sizes, usage) => {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
      const stride = sizes.reduce((a, c) => a + c, 0) * 4; let off = 0;
      sizes.forEach((n, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, off); off += n * 4; });
      return { v, b };
    };
    const quadArt = vao(new Float32Array([0, 0, SRC[0], 0, 0, SRC[1], 0, SRC[1], SRC[0], 0, SRC[0], SRC[1]]), [2]);
    const tri = vao(new Float32Array([-1, -1, 3, -1, -1, 3]), [2]);
    // the head: a grid over the head box, every point with its depth
    const dc = document.createElement('canvas'); dc.width = imDepth.width; dc.height = imDepth.height;
    const dg = dc.getContext('2d', { willReadFrequently: true }); dg.drawImage(imDepth, 0, 0);
    const dd = dg.getImageData(0, 0, dc.width, dc.height).data;
    const depthAt = (x, y) => {
      const i = 4 * (clamp(Math.round(y - HEAD[1]), 0, dc.height - 1) * dc.width + clamp(Math.round(x - HEAD[0]), 0, dc.width - 1));
      return [(dd[i] * 256 + dd[i + 1]) / 128 - 128, dd[i + 2] / 255];
    };
    const STEP = 2, gw = (HEAD[2] - HEAD[0]) / STEP, gh = (HEAD[3] - HEAD[1]) / STEP;
    const hv = new Float32Array((gw + 1) * (gh + 1) * 4);
    for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) {
      const x = HEAD[0] + i * STEP, y = HEAD[1] + j * STEP, [z, sw] = depthAt(x, y), o = 4 * (j * (gw + 1) + i);
      hv[o] = x; hv[o + 1] = y; hv[o + 2] = z; hv[o + 3] = sw;
    }
    const hi = new Uint32Array(gw * gh * 6);
    for (let j = 0, n = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const a = j * (gw + 1) + i, b = a + 1, c = a + gw + 1, d = c + 1;
      hi[n++] = a; hi[n++] = c; hi[n++] = b; hi[n++] = b; hi[n++] = c; hi[n++] = d;
    }
    const headMesh = vao(hv, [3, 1]);
    const headIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, headIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, hi, gl.STATIC_DRAW);
    const flyMesh = vao(new Float32Array(4096 * Fly.STRIDE), [2, 2, 1, 4], gl.DYNAMIC_DRAW);
    const sprData = new Float32Array(600 * 6 * 8), sprMesh = vao(sprData, [2, 2, 4], gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);

    // ---- targets for the butterfly's motion blur: one moment at a time into tmp, their mean in acc
    const target = float => {
      const t = gl.createTexture(), f = gl.createFramebuffer();
      return { t, f, float };
    };
    const tmp = target(false), acc = target(floatOK);
    const sizeTarget = (g, w, h, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, g.t);
      if (g.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    // ---- layout
    let view = null, lay = null, fly = null;
    function layout() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
      canvas.width = w; canvas.height = h; canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
      lay = h > w ? cfg.portrait : cfg.landscape;
      const s = h > w ? w / (SRC[0] - lay.left) : Math.max(w / SRC[0], h / SRC[1]);
      const ox = w - SRC[0] * s, oy = h - SRC[1] * s;                      // the picture stands in the bottom right corner
      view = { w, h, s, ox, oy, u: [2 * s / w, -2 * s / h, 2 * ox / w - 1, 1 - 2 * oy / h] };
      sizeTarget(tmp, w, h, 4); sizeTarget(acc, w, h, 5);
      fly = Fly.build(lay.route);
    }

    // ---- her head: 4x4 for points (x, y, depth) in picture pixels
    function headMatrix(pose, lift) {
      const rod = (k, a) => {                                    // rotation about the unit axis k
        const c = Math.cos(a), s = Math.sin(a), v = 1 - c, [x, y, z] = k;
        return [c + x * x * v, x * y * v - z * s, x * z * v + y * s, y * x * v + z * s, c + y * y * v, y * z * v - x * s, z * x * v - y * s, z * y * v + x * s, c + z * z * v];
      };
      const mul = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c]); return o; };
      const app = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
      const down = [Math.sin(LEAN), Math.cos(LEAN), 0], side = [Math.cos(LEAN), -Math.sin(LEAN), 0];
      // a positive turn about "down" carries the front of the face to the picture's right (her left), a positive
      // turn about "side" lifts the chin, a positive roll sets the head upright
      const R1 = mul(rod(down, pose.yaw * RAD), rod(side, pose.pitch * RAD));
      const R2 = rod([0, 0, 1], pose.roll * RAD);
      const R = mul(R2, R1);
      // x' = N + R2 (C + R1 (x - C) - N) + lift
      const c3 = [CEN[0], CEN[1], 0], n3 = [NECK[0], NECK[1], 0];
      const t1 = app(R1, c3).map((v, i) => c3[i] - v), t2 = app(R2, [t1[0] - n3[0], t1[1] - n3[1], t1[2]]);
      const tr = [n3[0] + t2[0], n3[1] + t2[1] + lift, t2[2]];
      const m = new Float32Array([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, tr[0], tr[1], tr[2], 1]);
      m.at3 = p => { const q = app(R, p); return [q[0] + tr[0], q[1] + tr[1], q[2] + tr[2]]; };
      return m;
    }

    // ---- the hand: it gives a little when the butterfly lands, and springs back when it leaves
    const armAngle = t => {
      let a = 0.0011 * Math.sin(TAU * t / (L / 5) + 0.7);
      if (t >= T.land && t < T.off) {
        const u = t - T.land;
        a += -0.0075 * Math.exp(-u / 0.42) * Math.cos(TAU * u / 0.95) * s3(u / 0.07) - 0.0022 * s3(u / 0.5) * (1 - s3(ramp(t, T.off - 0.3, T.off)));
      }
      if (t >= T.off) { const u = t - T.off; a += (-0.004 * Math.exp(-u / 0.12) + 0.0036 * Math.exp(-u / 0.5) * Math.sin(TAU * u / 1.0)) * s3(u / 0.05); }
      return a;
    };
    const BREATH = 1.7;
    const handAt = (t, p) => {                                   // where a point of the hand is at time t
      const a = armAngle(t), dx = p[0] - ELBOW[0], dy = p[1] - ELBOW[1];
      return [ELBOW[0] + dx * Math.cos(a) - dy * Math.sin(a), ELBOW[1] + dx * Math.sin(a) + dy * Math.cos(a) - 0.35 * BREATH * Story.breath(t)];
    };
    const flyAt = t => {                                         // the butterfly, riding the finger while it stands on it
      const S = fly.at(t);
      if (S.legs > 0) { const h = handAt(t, Fly.ROOT); S.x += (h[0] - Fly.ROOT[0]) * S.legs; S.y += (h[1] - Fly.ROOT[1]) * S.legs; }
      return S;
    };

    let nSpr = 0;
    const sprite = (x, y, r, col, sharp) => {
      const q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [u, v] of q) { const o = nSpr * 8; sprData[o] = x + u * r; sprData[o + 1] = y + v * r; sprData[o + 2] = u; sprData[o + 3] = v; sprData[o + 4] = col[0]; sprData[o + 5] = col[1]; sprData[o + 6] = col[2]; sprData[o + 7] = sharp; nSpr++; }
    };
    const flushSprites = () => {
      if (!nSpr) return;
      gl.useProgram(P.spr.p); gl.uniform4fv(P.spr.u.uView, view.u);
      gl.bindVertexArray(sprMesh.v); gl.bindBuffer(gl.ARRAY_BUFFER, sprMesh.b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sprData.subarray(0, nSpr * 8));
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, 0, nSpr); nSpr = 0;
    };
    const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

    function draw(t) {
      const { w, h } = view;
      const S = flyAt(t);
      const pose = Story.head(t, { yaw: S.lookYaw, pitch: S.lookPitch });
      const br = BREATH * Story.breath(t), flare = Story.flare(t);
      const M = headMatrix(pose, -br);
      // the butterfly as a lamp
      const lamp = S.alpha * (0.75 + 0.25 * Math.sin(S.phi)), near = Math.hypot(S.x - Fly.ROOT[0], S.y - Fly.ROOT[1]);
      const uFly = [S.x, S.y - 30 * S.s, 0.42 * lamp * S.s * S.s, 120 * S.s];
      const handLight = S.alpha * s3(1 - clamp((near - 12) / 190, 0, 1)) * (0.8 + 0.2 * Math.sin(S.phi));

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);

      // the picture
      gl.useProgram(P.plate.p);
      gl.uniform1i(P.plate.u.uPlate, 0); gl.uniform1i(P.plate.u.uHand, 1);
      gl.uniform4fv(P.plate.u.uView, view.u); gl.uniform1f(P.plate.u.uZ, -BODYZ / 600);
      gl.uniform4fv(P.plate.u.uHandBox, HAND); gl.uniform2f(P.plate.u.uHandMix, handLight, 0.7 * S.perch);
      gl.uniform1f(P.plate.u.uBreath, br); gl.uniform1f(P.plate.u.uArm, armAngle(t));
      gl.uniform1f(P.plate.u.uRed, 0.16 * Math.sin(TAU * t / (L / 6)) + 0.07 * Math.sin(TAU * t / (L / 16) + 1));
      gl.uniform4fv(P.plate.u.uFly, uFly);
      gl.bindVertexArray(quadArt.v); gl.drawArrays(gl.TRIANGLES, 0, 6);

      // her head
      gl.useProgram(P.head.p);
      gl.uniform1i(P.head.u.uHead, 2); gl.uniform1i(P.head.u.uHeadB, 6); gl.uniform1i(P.head.u.uBand, 7); gl.uniform4fv(P.head.u.uView, view.u); gl.uniformMatrix4fv(P.head.u.uM, false, M);
      const yawAt = tt => Story.head(tt, { yaw: 0, pitch: 0 }).yaw;
      const lag = 0.6 * (yawAt(t - 0.2) - yawAt(t)) - 0.25 * (yawAt(t - 0.5) - yawAt(t - 0.3));
      gl.uniform3f(P.head.u.uSway, 1.5, 3 * t / L, lag);
      gl.uniform3f(P.head.u.uEye, 0.5 + 0.5 * Math.sin(TAU * t / (L / 10)), flare, clamp(Math.sin(clamp(pose.yaw, 0, 90) * RAD) / Math.sin(0.8 * Story.YAW * RAD), 0, 1));
      const dark = s3(clamp((pose.yaw / Story.YAW - 0.05) / 0.8, 0, 1));                        // it comes on and goes with the turn
      gl.uniform1f(P.head.u.uDark, dark);
      // the line of her far cheek and jaw rides on the head. As painted the cheek stands up to 22 pixels outside it;
      // over the first 8 degrees of the turn it is drawn in to the line, and it stays on it from there
      const ja = M.at3(cfg.jaw[0]), jb = M.at3(cfg.jaw[1]), y = pose.yaw;
      const slack = y <= 0.3 ? 30 : y < 0.9 ? lerp(30, 22, (y - 0.3) / 0.6) : 22 * (1 - s3(clamp((y - 0.9) / 7.3, 0, 1)));
      gl.uniform4f(P.head.u.uJaw, ja[0], ja[1], jb[0], jb[1]);
      gl.uniform2f(P.head.u.uTrim, slack, lerp(1.2, 16, dark));
      gl.uniform4f(P.head.u.uEyes, (EYES[0][0] - HEAD[0]) / (HEAD[2] - HEAD[0]), (EYES[0][1] - HEAD[1]) / (HEAD[3] - HEAD[1]), (EYES[1][0] - HEAD[0]) / (HEAD[2] - HEAD[0]), (EYES[1][1] - HEAD[1]) / (HEAD[3] - HEAD[1]));
      gl.uniform4fv(P.head.u.uFly, uFly);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(headMesh.v); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, headIdx);
      gl.drawElements(gl.TRIANGLES, hi.length, gl.UNSIGNED_INT, 0);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);

      // the glow of her eyes
      const pulse = 0.5 + 0.5 * Math.sin(TAU * t / (L / 10));
      for (const [ex, ey, k] of EYES) {
        const q = M.at3([ex, ey, depthAt(ex, ey)[0]]);
        const e = 0.5 + 0.25 * pulse + 1.0 * flare;
        sprite(q[0], q[1], 52 * k * (1 + 0.3 * flare), [0.20 * e, 0.185 * e, 0.07 * e], 3.4);
        if (flare > 0.01) sprite(q[0], q[1], 170 * k, [0.045 * flare, 0.04 * flare, 0.014 * flare], 2.4);
      }
      // the butterfly's halo, behind it
      if (S.alpha > 0) {
        sprite(S.x, S.y - 28 * S.s, 150 * S.s, [0.012 * lamp, 0.075 * lamp, 0.105 * lamp], 2.6);
        sprite(S.x, S.y - 28 * S.s, 62 * S.s, [0.02 * lamp, 0.10 * lamp, 0.14 * lamp], 2.2);
      }
      flushSprites();

      // the butterfly: eight moments of this frame's exposure, averaged
      if (S.alpha > 0) {
        const still = S.perch > 0.999 && Math.abs(S.dphi) < 0.25, K = still ? 1 : 8, SHUTTER = 0.55 / 30;
        const sub = [];
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let k = 0; k < K; k++) {
          const Sk = K === 1 ? S : flyAt(t + ((k + 0.5) / K - 0.5) * SHUTTER);
          if (K > 1) Sk.alpha = S.alpha;
          const m = Fly.mesh(Sk), d = m.data.slice(0, m.count * Fly.STRIDE);
          for (let i = 0; i < m.count; i++) { const x = d[i * Fly.STRIDE], y = d[i * Fly.STRIDE + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          sub.push({ d, n: m.count });
        }
        const sx0 = clamp(Math.floor(x0 * view.s + view.ox) - 3, 0, w), sx1 = clamp(Math.ceil(x1 * view.s + view.ox) + 3, 0, w);
        const sy0 = clamp(Math.floor(y0 * view.s + view.oy) - 3, 0, h), sy1 = clamp(Math.ceil(y1 * view.s + view.oy) + 3, 0, h);
        if (sx1 > sx0 && sy1 > sy0) {
          gl.enable(gl.SCISSOR_TEST); gl.scissor(sx0, h - sy1, sx1 - sx0, sy1 - sy0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, acc.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          for (const { d, n } of sub) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.f); gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(P.fly.p); gl.uniform1i(P.fly.u.uWing, 3); gl.uniform4fv(P.fly.u.uView, view.u);
            gl.bindVertexArray(flyMesh.v); gl.bindBuffer(gl.ARRAY_BUFFER, flyMesh.b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLES, 0, n);
            gl.bindFramebuffer(gl.FRAMEBUFFER, acc.f);
            gl.useProgram(P.blit.p); gl.uniform1i(P.blit.u.uTex, 4);
            gl.blendColor(0, 0, 0, 1 / K); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE);
            gl.bindVertexArray(tri.v); gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.useProgram(P.blit.p); gl.uniform1i(P.blit.u.uTex, 5);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.bindVertexArray(tri.v); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.disable(gl.SCISSOR_TEST);
        }
      }

      // motes of light shaken off its wings: they hang, sink and go out
      const GAP = 0.085;
      for (let n = Math.floor((t - 2.6 - T.enter) / GAP); n <= (t - T.enter) / GAP; n++) {
        if (n < 0) continue;
        const born = T.enter + n * GAP, age = t - born, life = 1.1 + 1.4 * hash(n * 3.1);
        if (age < 0 || age > life || hash(n * 7.7) < 0.35) continue;
        const B = fly.at(born);
        if (B.alpha < 0.2 || B.legs > 0.6) continue;
        const x = B.x + (hash(n) - 0.5) * 60 * B.s + (hash(n * 1.7) - 0.5) * 26 * age * B.s + 5 * B.s * Math.sin(age * 2.3 + n);
        const y = B.y - 30 * B.s + (hash(n * 2.3) - 0.5) * 70 * B.s + (9 + 14 * hash(n * 5.3)) * age * age * 0.5 * B.s + 6 * age * B.s;
        const a = s3(age / 0.12) * Math.pow(1 - age / life, 1.5) * B.alpha * (0.6 + 0.4 * Math.sin(age * (9 + 8 * hash(n * 4.1)) + n));
        const r = (2.2 + 3.2 * hash(n * 9.1)) * Math.max(B.s, 0.45);
        sprite(x, y, r * 2.2, [0.25 * a, 0.75 * a, 0.95 * a], 3.5);
      }
      flushSprites();

      // into the dark at the right edge
      gl.useProgram(P.fade.p); gl.uniform4f(P.fade.u.uInv, 1 / view.s, 1 / view.s, -view.ox / view.s, -view.oy / view.s); gl.uniform1f(P.fade.u.uRes, h);
      gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO); gl.bindVertexArray(tri.v); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }

    function frame() {
      const now = frozen !== null ? frozen : performance.now() / 1000;
      draw(((now % L) + L) % L);
      if (frozen === null) requestAnimationFrame(frame);
    }
    layout(); addEventListener('resize', () => { layout(); if (frozen !== null) frame(); });
    frame(); window.__ready = true;
  }
  window.Scene = { run };
})();
