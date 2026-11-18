// The cat's story: up over the books, a hop to the sill, lies and looks out, gets up, stretches, jumps down onto
// the desk and walks off along it. Two layouts with the same loop length:
//   landscape  the whole window: lies where the picture's cat lay, strolls on along the sill before it jumps down
//   portrait   the phone's slice (books and the right pane): everything happens inside it
(function () {
  const P = Rig.P, C = Rig.CYCLE, SILL = 211, BOOKS = 214, DESK = 246, L = 35;
  const o = (...a) => Object.assign({}, ...a);
  function build(pt) {
    const sill = pt ? 350 : 336;                 // where the hop lands
    const c1 = pt ? 0.5 : 2.5;                   // walk cycles to the lying spot
    const spot = sill - 2 - c1 * C;
    const c2 = pt ? 0 : 4;                       // walk cycles along the sill after the stretch
    const edge = spot - c2 * C;                  // where it jumps down from
    const c3 = pt ? 3.5 : 8.5;                   // walk cycles along the desk, out of the picture
    const dx = pt ? 14 : 26;                     // how far forward the jump down carries it
    const k = [
      [0,    o(P.stand, P.fly, { x: 384, y: 300, face: -1 })],
      // up onto the books
      [0.42, o(P.mantle, { x: 378, y: BOOKS }), { e: 'out' }],
      [0.14, o(P.squash, { bn: [-12, 0], bf: [-9, 0] })],
      [0.40, o(P.stand, { head: [12, 12] })],
      [pt ? 1.7 : 0.7, { head: [11, 13] }],
      // hop over to the sill
      [0.35, o(P.crouch)],
      [0.15, { hip: [-15, 15], head: [12, 13] }],
      [0.10, o(P.launch, { sh: [17, 30], fn: [27, 24], ff: [24, 21] }), { e: 'in' }],
      [0.40, o(P.reach, { x: sill, y: SILL }), { arc: pt ? 7 : 9 }],
      [0.12, o(P.squash)],
      [0.40, o(P.stand)],
      // along the sill
      [0.25, o(P.walk, { x: sill - 2, ph: 2 / C })],
      [c1 - 2 / C, { x: spot, ph: c1 }, { e: 'lin' }],
      [0.35, o(P.stand, { ph: c1 })],
      [0.50, { head: [12, 13] }],
      // lie down and look out
      [0.55, o(P.haunch)],
      [0.80, o(P.lie, pt ? { tail: [-60, 150, 60] } : {})],
      [1.4, {}],
      [0.09, { ear: 1 }], [0.16, { ear: 0 }],
      [0.6, {}],
      [0.12, { flick: 1 }], [0.22, { flick: 0 }],
      [pt ? 2.6 : 1.3, {}],
      [0.12, { flick: 0.7 }], [0.15, { flick: 0 }], [0.12, { flick: 1 }], [0.25, { flick: 0 }],
      [pt ? 1.6 : 0.9, {}],
      [0.09, { ear: 1 }], [0.16, { ear: 0 }],
      [pt ? 1.4 : 0, {}],
      // up, and the stretch
      [0.55, o(P.haunch, { head: [10, 12], turn: 0 })],
      [0.50, o(P.stand)],
      [0.25, {}],
      [0.70, o(P.bow)],
      [0.50, { hip: [-18, 31], sh: [10, 10], tail: [70, 30, 40] }],
      [0.50, { hip: [-17, 30], sh: [11, 10.5] }],
      [0.60, o(P.lunge)],
      [0.50, { bf: [-34, 6] }],
    ];
    if (c2) k.push(
      [0.40, o(P.walk, { ph: 0 })],
      [c2, { x: edge, ph: c2 }, { e: 'lin' }],
      [0.35, o(P.stand, { ph: c2 })]);
    else k.push([0.45, o(P.stand)]);
    k.push(
      // down onto the desk: a look, the weight goes back, the front paws lead, the hind legs follow
      [0.50, o(P.peer)],
      [0.20, {}],
      [0.28, o(P.crouch, { head: [13, 3], sh: [15, 13], hip: [-15, 19] })],
      [0.10, o(P.dive, { bn: [-19, 3], bf: [-16, 3], hip: [-16, 21], fn: [24, -6], ff: [21, -4] }), { e: 'in' }],
      [0.34, o(P.dive, { x: edge - dx, y: DESK, fn: [24, 0], ff: [21, 2], bn: [-26, 20], bf: [-23, 24] }), { arc: -5 }],
      [0.10, o(P.reach, { sh: [14, 15], head: [13, 7], tail: [60, 10, 0] })],
      [0.12, o(P.squash)],
      [0.45, o(P.stand, { tail: [-10, 30, 30] })],
      [pt ? 0.9 : 0.3, { head: [12, 12] }],
      // and away along the desk
      [0.30, o(P.walk, { x: edge - dx - 2, ph: 2 / C })],
      [(c3 - 2 / C) * 0.8, { x: edge - dx - c3 * C, ph: c3 }, { e: 'lin' }]);
    const tl = Rig.timeline(k, pt ? 2.4 : 1.5);
    if (tl.T > L - 1) console.error('timeline too long', tl.T);
    return tl;
  }
  window.CAT = { L, landscape: build(false), portrait: build(true) };
})();
