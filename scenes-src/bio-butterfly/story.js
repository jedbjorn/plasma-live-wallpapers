// The story, in seconds of the loop, and what she does. Everything here is a pure function of the loop time,
// and the loop ends exactly as it starts: the butterfly out of sight, her head as painted.
//
//   enter  the butterfly comes out of the dark          land   it settles on her finger
//   turn   she starts to turn her head to the viewer    stare  she faces the viewer
//   off    the butterfly lifts off                      gone   it is out of sight
//   back   she starts to look back at her finger        home   as painted again
(function () {
  const L = 32;
  const T = { enter: 1.0, hover: 9.5, land: 10.4, turn: 15.7, stare: 17.3, open: 21.3, off: 21.9, gone: 25.6, back: 25.9, home: 28.7 };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const s3 = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const s5 = u => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
  const ramp = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const TAU = Math.PI * 2;
  const YAW = 27;                         // degrees from the painted pose to facing the viewer

  // how far her head is turned to the viewer, 0 (as painted) .. 1: it comes round with a soft stop and goes
  // back slower than it came.
  function turn(t) {
    if (t < T.turn) return 0;
    if (t < T.stare) { const u = ramp(t, T.turn, T.stare); return s5(u) + 0.035 * Math.sin(Math.PI * u) * u * u; }
    if (t < T.back) return 1;
    if (t < T.home) return 1 - s5(ramp(t, T.back, T.home));
    return 0;
  }
  // her eyes flare when they meet the viewer's, and throb slowly while she stares
  function flare(t) {
    const up = s3(ramp(t, T.stare - 0.45, T.stare + 0.7)), down = 1 - s3(ramp(t, T.back - 0.2, T.back + 1.3));
    const k = up * down;
    return k * (0.82 + 0.18 * Math.sin(TAU * (t - T.stare) / 2.6 - 0.6));
  }
  const breath = t => {                   // 8 breaths a loop: in a little faster than out
    const u = (t / (L / 8)) % 1;
    return u < 0.42 ? s3(u / 0.42) : 1 - s3((u - 0.42) / 0.58);
  };

  // the head: degrees. yaw turns the face to the viewer (YAW = square on), roll un-tilts it, pitch lifts the chin.
  // look = {yaw, pitch} is where the butterfly draws her eyes while it comes down (from Fly, already smooth).
  function head(t, look) {
    const u = turn(t);
    const hold = s3(ramp(t, T.stare, T.stare + 3.4)) * (1 - s3(ramp(t, T.back, T.back + 1.2)));   // the stare deepens
    const idle = 0.35 * Math.sin(TAU * t / (L / 4) + 1.0) + 0.2 * Math.sin(TAU * t / (L / 6));
    const near = s3(ramp(t, T.land + 0.9, T.land + 2.6)) * (1 - s3(ramp(t, T.turn - 1.6, T.turn - 0.2)));   // she leans in to look at it
    return {
      yaw: YAW * u + look.yaw + 0.5 * idle - 1.2 * near,
      roll: 6.5 * u + 2.6 * hold + 0.4 * idle - 1.8 * near,
      pitch: 3.2 * u - 1.3 * hold + look.pitch + 0.3 * Math.sin(TAU * t / (L / 4)) - 1.0 * near,
    };
  }

  window.Story = { L, T, YAW, turn, flare, breath, head, s3, s5, ramp, clamp, lerp };
})();
