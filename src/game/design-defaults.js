// The look the design tools change: cameras, car body, HUD theme and HUD layout.
// T opens the tweak panel, L the HUD layout mode. Edits are saved in localStorage (`gridline.design`);
// to make a design the permanent default, export it from the panel and paste it over this object.
// Car coordinates are metres in car space: +x forward, +y up, +z toward the driver's right.
// The left-hand twin of a right-hand part (names ending in R): z, z offsets and rotations mirrored.
const mirrorZ = p => ({ ...p, name: p.name.replace(/R(\d?)$/, 'L$1'), pos: [p.pos[0], p.pos[1], -p.pos[2]],
  ...(p.rot ? { rot: [-p.rot[0], -p.rot[1], p.rot[2]] } : {}),
  ...(p.shape === 'rod' ? { size: [p.size[0], p.size[1], -p.size[2]] } : {}),
  ...(p.sections ? { sections: p.sections.map(s => s.length > 5 ? [...s.slice(0, 5), -s[5]] : s) } : {}) });
const withMirrors = parts => parts.flatMap(p => /R\d?$/.test(p.name) && !p.steer ? [p, mirrorZ(p)] : [p]);

export const DESIGN_DEFAULTS = {
  version: 8,
  // Camera modes, cycled with C / Y. back/side/height/ahead/lookY are metres relative to the car.
  // k = follow stiffness, rigid = no smoothing, cockpitBody = player car shows its cockpit-view parts.
  cameras: [
    { id: 'chase',   label: 'Chase',   back: 9.5,  side: 0, height: 3.3,  ahead: 7,  lookY: 1.1, k: 7,  near: 0.5,  fov: 60, fovGain: 14, lean: 0,     rigid: false, cockpitBody: false },
    { id: 'cockpit', label: 'Cockpit', back: 0.33, side: 0, height: 0.77, ahead: 30, lookY: 0.8, k: 30, near: 0.12, fov: 56, fovGain: 10, lean: 0.035, rigid: true,  cockpitBody: true },
    { id: 'high',    label: 'High',    back: 16,   side: 0, height: 7,    ahead: 10, lookY: 0.5, k: 4,  near: 0.5,  fov: 60, fovGain: 14, lean: 0,     rigid: false, cockpitBody: false },
  ],
  car: {
    // shape + size: box [length, height, width] · rounded (box with rounded y-z corners, + radius) · sphere [radius]
    //   · cylinder [radius, length] (axis = y) · torus [radius, tube, arc°] · loft (smooth body through `sections`
    //   [x, y, halfWidth, halfHeight, roundness, z?], size = scale) · wing [chord, thickness, span] (airfoil, + camber)
    //   · rod (tube from pos to pos + size, + radius) · decal [width, height] (the car's race number, face up)
    // finish (optional): paint | carbon | rubber | metal | light (brake light) | decal; default from the colour role.
    // Parts named "… R" get a mirrored "… L" twin (withMirrors).
    // color: body | accent | dark | tyre | '#rrggbb'.  show: always | outside (hidden in cockpit view) | cockpit (only there) | off
    // steer: part of the steering wheel: positioned relative to the wheel centre (steering.pivot), moves/tilts/scales with
    //   the wheel and turns with the steering input.  Omitted fields: rot [0,0,0], show always, steer false.
    parts: withMirrors([
      // the body as one surface (car-body.js): survival cell + nose, sidepods, engine cover, airbox, with the cockpit
      // opening, sidepod inlets and airbox intake cut into it; the nose tip ahead of accentFrom is the accent colour
      { name: 'body', shape: 'body', size: [1, 1, 1], pos: [0, 0, 0], color: 'body', accentFrom: 3.05,
        tub: [
          [3.36, 0.248, 0.035, 0.022, 2], [3.32, 0.25, 0.06, 0.042, 2.2], [3.2, 0.26, 0.085, 0.058, 2.3], [3.0, 0.28, 0.11, 0.075, 2.4],
          [2.5, 0.34, 0.16, 0.11, 2.6], [2.0, 0.42, 0.21, 0.15, 2.8], [1.5, 0.47, 0.26, 0.19, 3], [1.0, 0.5, 0.31, 0.22, 3.2],
          [0.6, 0.5, 0.36, 0.24, 3.4], [0.0, 0.47, 0.4, 0.23, 3.6], [-0.4, 0.47, 0.4, 0.24, 3.6], [-0.8, 0.42, 0.34, 0.2, 3.2],
          [-1.3, 0.38, 0.25, 0.16, 3], [-1.9, 0.36, 0.15, 0.12, 2.6], [-2.3, 0.38, 0.08, 0.08, 2.2]],
        // sidepods: inlet up top, the body below it reaching down to the floor (narrower at the bottom: the undercut)
        pods: [
          [0.42, 0.475, 0.11, 0.12, 3.2, 0.525], [0.37, 0.43, 0.15, 0.2, 2.8, 0.53], [0.2, 0.38, 0.2, 0.27, 2.6, 0.53],
          [-0.3, 0.36, 0.22, 0.28, 2.6, 0.53], [-0.8, 0.32, 0.18, 0.24, 2.5, 0.48], [-1.3, 0.26, 0.12, 0.17, 2.4, 0.4],
          [-1.8, 0.2, 0.03, 0.06, 2.2, 0.16]],
        cover: [
          [-0.42, 0.62, 0.2, 0.28, 2.8], [-0.68, 0.64, 0.25, 0.3, 3], [-0.95, 0.62, 0.25, 0.27, 3], [-1.35, 0.56, 0.2, 0.21, 2.8],
          [-1.85, 0.5, 0.12, 0.15, 2.4], [-2.25, 0.41, 0.04, 0.05, 2.2]],
        airbox: [
          [-0.44, 1.0, 0.07, 0.085, 2.4], [-0.48, 0.98, 0.1, 0.17, 2.4], [-0.72, 0.96, 0.11, 0.16, 2.4], [-1.05, 0.86, 0.08, 0.12, 2.4],
          [-1.5, 0.68, 0.03, 0.05, 2.2]],
        // under the tub, down into the floor plate: the body sits on the floor (the sidepods reach down to it too)
        keel: [
          [1.5, 0.16, 0.12, 0.09, 4], [1.0, 0.17, 0.2, 0.1, 4], [0.4, 0.18, 0.26, 0.11, 4], [-0.6, 0.18, 0.27, 0.11, 4],
          [-1.4, 0.18, 0.2, 0.11, 4], [-2.0, 0.2, 0.1, 0.1, 3]],
        cockpit: { from: 0.52, to: -0.42, floor: 0.28, side: 35 } },
      { name: 'shark fin', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'body', sections: [
        [-0.95, 0.95, 0.008, 0.06, 6], [-1.3, 0.86, 0.01, 0.1, 6], [-1.7, 0.78, 0.01, 0.12, 6], [-1.98, 0.72, 0.008, 0.1, 6]] },
      { name: 'camera pod', shape: 'rounded', size: [0.16, 0.05, 0.11], radius: 0.02, pos: [-0.62, 1.16, 0], color: 'accent' },
      // floor: one plate from the nose to the diffuser, which kicks up behind the rear axle; fences and side walls
      // under the ramp
      { name: 'floor', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', sections: [
        [1.35, 0.075, 0.26, 0.018, 8], [0.85, 0.075, 0.6, 0.018, 10], [0.2, 0.075, 0.8, 0.018, 10], [-0.75, 0.075, 0.78, 0.018, 10],
        [-1.15, 0.075, 0.6, 0.018, 10], [-1.6, 0.08, 0.56, 0.018, 10], [-1.9, 0.095, 0.53, 0.016, 10], [-2.15, 0.16, 0.5, 0.014, 10],
        [-2.4, 0.25, 0.48, 0.014, 10]] },
      { name: 'diffuser fence R', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', sections: [
        [-1.85, 0.085, 0.006, 0.012, 6, 0.18], [-2.15, 0.12, 0.006, 0.05, 6, 0.18], [-2.4, 0.18, 0.006, 0.075, 6, 0.18]] },
      { name: 'diffuser fence 2 R', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', sections: [
        [-1.85, 0.085, 0.006, 0.012, 6, 0.34], [-2.15, 0.12, 0.006, 0.05, 6, 0.34], [-2.4, 0.18, 0.006, 0.075, 6, 0.34]] },
      { name: 'diffuser wall R', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', sections: [
        [-1.8, 0.09, 0.008, 0.02, 6, 0.49], [-2.15, 0.14, 0.008, 0.07, 6, 0.48], [-2.4, 0.2, 0.008, 0.1, 6, 0.47]] },
      // front wing: main plane, two flaps, endplates; pillars hold it under the nose
      { name: 'front wing main', shape: 'wing', size: [0.34, 0.03, 1.94], camber: 0.06, pos: [3.12, 0.1, 0], rot: [0, 0, -3], color: 'body' },
      // open: degrees the part turns (about its own position) in straight mode (active aero): the flaps flatten
      { name: 'front wing flap 1', shape: 'wing', size: [0.2, 0.022, 1.86], camber: 0.07, pos: [2.92, 0.155, 0], rot: [0, 0, -18], open: 11, color: 'accent' },
      { name: 'front wing flap 2', shape: 'wing', size: [0.16, 0.018, 1.78], camber: 0.08, pos: [2.79, 0.215, 0], rot: [0, 0, -32], open: 20, color: 'accent' },
      { name: 'front endplate R', shape: 'rounded', size: [0.016, 0.21, 0.56], radius: 0.07, pos: [3.0, 0.17, 0.97], rot: [0, 90, 0], color: 'body' },
      { name: 'front wing pillar R', shape: 'box', size: [0.16, 0.1, 0.014], pos: [3.06, 0.16, 0.055], color: 'dark' },
      // rear wing: main plane + flap (both flatten in straight mode) between curved endplates with LED strips, two
      // swan-neck pylons from the crash structure, a two-element beam wing
      { name: 'rear wing main', shape: 'wing', size: [0.34, 0.045, 1.0], camber: 0.08, pos: [-2.12, 0.94, 0], rot: [0, 0, -7], open: 4, color: 'body' },
      { name: 'rear wing flap', shape: 'wing', size: [0.22, 0.024, 1.0], camber: 0.07, pos: [-2.31, 1.06, 0], rot: [0, 0, -30], open: 24, color: 'accent' },
      { name: 'rear endplate R', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'body', sections: [
        [-1.93, 0.94, 0.01, 0.04, 6, 0.515], [-1.99, 0.93, 0.01, 0.1, 10, 0.515], [-2.12, 0.94, 0.01, 0.14, 12, 0.515],
        [-2.32, 0.96, 0.01, 0.16, 12, 0.515], [-2.44, 0.97, 0.01, 0.15, 10, 0.515]] },
      { name: 'wing pylon R', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', sections: [
        [-2.2, 0.42, 0.008, 0.05, 4, 0.06], [-2.17, 0.62, 0.008, 0.07, 4, 0.06], [-2.08, 0.86, 0.008, 0.06, 4, 0.06], [-2.02, 0.97, 0.008, 0.035, 4, 0.06]] },
      { name: 'beam wing', shape: 'wing', size: [0.18, 0.022, 0.86], camber: 0.06, pos: [-2.24, 0.47, 0], rot: [0, 0, -8], color: 'dark' },
      { name: 'beam wing flap', shape: 'wing', size: [0.13, 0.018, 0.86], camber: 0.07, pos: [-2.38, 0.53, 0], rot: [0, 0, -24], color: 'dark' },
      { name: 'beam wing plate R', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', sections: [
        [-2.14, 0.47, 0.006, 0.02, 5, 0.435], [-2.3, 0.5, 0.006, 0.05, 5, 0.435], [-2.45, 0.54, 0.006, 0.03, 5, 0.435]] },
      // brake lights: rain light on the crash structure, LED strips on the endplates' trailing edges
      { name: 'rain light', shape: 'box', size: [0.03, 0.065, 0.12], pos: [-2.31, 0.38, 0], color: '#ff2a18', finish: 'light' },
      { name: 'endplate light R', shape: 'box', size: [0.02, 0.24, 0.026], pos: [-2.445, 0.97, 0.515], color: '#ff2a18', finish: 'light' },
      // driver, halo, mirrors
      { name: 'helmet', shape: 'sphere', size: [0.135], pos: [-0.28, 0.8, 0], color: 'accent', show: 'outside' },
      { name: 'visor', shape: 'torus', size: [0.125, 0.026, 130], pos: [-0.28, 0.825, 0], rot: [90, 0, -65], color: '#101215', finish: 'metal', show: 'outside' },
      // halo: one titanium hoop with an aero fairing (oval, slim on top), its legs on the cockpit sides behind the
      // driver's shoulders, narrowing to the front, where the central pillar curves down to the chassis
      { name: 'halo', shape: 'tube', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', section: [0.03, 0.017], path: [
        [-0.34, 0.66, -0.3, 0.05, 0.035], [-0.3, 0.8, -0.3, 0.036, 0.024], [-0.22, 0.915, -0.285], [-0.08, 0.955, -0.255],
        [0.1, 0.965, -0.2], [0.25, 0.962, -0.13], [0.345, 0.96, -0.06], [0.375, 0.958, 0], [0.345, 0.96, 0.06], [0.25, 0.962, 0.13], [0.1, 0.965, 0.2],
        [-0.08, 0.955, 0.255], [-0.22, 0.915, 0.285], [-0.3, 0.8, 0.3, 0.036, 0.024], [-0.34, 0.66, 0.3, 0.05, 0.035]] },
      { name: 'halo pillar', shape: 'tube', size: [1, 1, 1], pos: [0, 0, 0], color: 'dark', section: [0.022, 0.026], up: [1, 0, 0], path: [
        [0.375, 0.96, 0, 0.026, 0.024], [0.43, 0.9, 0], [0.49, 0.8, 0, 0.026, 0.03], [0.535, 0.71, 0, 0.04, 0.05]] },
      { name: 'mirror R', shape: 'rounded', size: [0.07, 0.06, 0.16], radius: 0.02, pos: [0.62, 0.8, 0.5], color: 'body' },
      { name: 'mirror glass R', shape: 'box', size: [0.004, 0.045, 0.14], pos: [0.584, 0.8, 0.5], color: '#9fb0c0', finish: 'metal' },
      { name: 'mirror stalk R', shape: 'rod', size: [0.06, 0.13, 0.12], radius: 0.012, pos: [0.56, 0.66, 0.37], color: 'dark' },
      // suspension: wishbones and push/pull rods from the chassis to the wheel uprights
      { name: 'front upper wishbone R1', shape: 'rod', size: [0.25, 0.04, 0.55], radius: 0.014, pos: [1.5, 0.52, 0.17], color: 'dark' },
      { name: 'front upper wishbone R2', shape: 'rod', size: [-0.3, 0.06, 0.6], radius: 0.014, pos: [2.05, 0.5, 0.12], color: 'dark' },
      { name: 'front lower wishbone R1', shape: 'rod', size: [0.25, -0.06, 0.53], radius: 0.014, pos: [1.5, 0.32, 0.2], color: 'dark' },
      { name: 'front lower wishbone R2', shape: 'rod', size: [-0.3, -0.04, 0.57], radius: 0.014, pos: [2.05, 0.3, 0.16], color: 'dark' },
      { name: 'front push rod R', shape: 'rod', size: [0.12, 0.32, -0.5], radius: 0.012, pos: [1.73, 0.27, 0.72], color: 'dark' },
      { name: 'rear upper wishbone R1', shape: 'rod', size: [0.3, 0.05, 0.56], radius: 0.014, pos: [-1.85, 0.47, 0.13], color: 'dark' },
      { name: 'rear upper wishbone R2', shape: 'rod', size: [-0.25, 0.05, 0.53], radius: 0.014, pos: [-1.3, 0.46, 0.17], color: 'dark' },
      { name: 'rear lower wishbone R1', shape: 'rod', size: [0.3, -0.04, 0.55], radius: 0.014, pos: [-1.85, 0.28, 0.15], color: 'dark' },
      { name: 'rear lower wishbone R2', shape: 'rod', size: [-0.25, -0.04, 0.52], radius: 0.014, pos: [-1.3, 0.28, 0.18], color: 'dark' },
      { name: 'rear pull rod R', shape: 'rod', size: [0.15, -0.2, -0.5], radius: 0.012, pos: [-1.6, 0.5, 0.69], color: 'dark' },
      // race number on the nose and both sides of the fin
      { name: 'number nose', shape: 'decal', size: [0.2, 0.2], pos: [2.28, 0.522, 0], rot: [0, -90, -12], color: '#ffffff', finish: 'decal' },
      { name: 'number fin R', shape: 'decal', size: [0.2, 0.2], pos: [-1.55, 0.82, 0.0115], rot: [90, 0, 0], color: '#ffffff', finish: 'decal' },
      // F1-style steering wheel, cockpit view only. Positions are relative to the wheel centre (steering.pivot);
      // the live screen (car.screen) sits on its face
      { name: 'wheel body',       shape: 'rounded', size: [0.035, 0.13, 0.24], radius: 0.03, pos: [0, 0, 0], color: 'dark', show: 'cockpit', steer: true },
      { name: 'wheel grip R',     shape: 'rounded', size: [0.055, 0.16, 0.055], radius: 0.022, pos: [0.005, -0.01, 0.135], color: 'tyre', show: 'cockpit', steer: true },
      { name: 'wheel grip L',     shape: 'rounded', size: [0.055, 0.16, 0.055], radius: 0.022, pos: [0.005, -0.01, -0.135], color: 'tyre', show: 'cockpit', steer: true },
      { name: 'screen bezel',     shape: 'rounded', size: [0.01, 0.06, 0.098], radius: 0.006, pos: [-0.02, 0.017, 0], color: '#0b0d10', show: 'cockpit', steer: true },
      { name: 'button 1',         shape: 'cylinder', size: [0.008, 0.012], pos: [-0.021, -0.035, -0.06], rot: [0, 0, 90], color: '#ff2b2b', show: 'cockpit', steer: true },
      { name: 'button 2',         shape: 'cylinder', size: [0.008, 0.012], pos: [-0.021, -0.035, -0.02], rot: [0, 0, 90], color: 'accent', show: 'cockpit', steer: true },
      { name: 'button 3',         shape: 'cylinder', size: [0.008, 0.012], pos: [-0.021, -0.035, 0.02],  rot: [0, 0, 90], color: '#2e6bff', show: 'cockpit', steer: true },
      { name: 'button 4',         shape: 'cylinder', size: [0.008, 0.012], pos: [-0.021, -0.035, 0.06],  rot: [0, 0, 90], color: '#36d27f', show: 'cockpit', steer: true },
    ]),
    wheels: [
      { name: 'front right', pos: [1.75, 0.36, 0.86],   radius: 0.36, width: 0.36, front: true },
      { name: 'front left',  pos: [1.75, 0.36, -0.86],  radius: 0.36, width: 0.36, front: true },
      { name: 'rear right',  pos: [-1.55, 0.38, 0.88],  radius: 0.38, width: 0.46, front: false },
      { name: 'rear left',   pos: [-1.55, 0.38, -0.88], radius: 0.38, width: 0.46, front: false },
    ],
    // the steering wheel as one unit (every steer part + the screen): pivot = its centre in car space,
    // rot = degrees (z + leans the top toward the driver), scale = [x, y, z] stretch, lock = degrees turned at full input
    steering: { pivot: [0.18, 0.675, 0], rot: [0, 0, 0], scale: [1, 1, 1], lock: 90 },
    // live screen (rev lights, speed, gear), fixed to the player's steering wheel: pos/rot relative to the wheel
    // centre, size = [width, height] in metres
    screen: { show: 'cockpit', pos: [-0.0255, 0.017, 0], rot: [0, -90, 0], size: [0.088, 0.052] },
  },
  hud: {
    theme: { accent: '#ffc21a', panel: '#0a0d11', panelOpacity: 0.86, text: '#f2f3f0', muted: '#959ca5', radius: 3, font: 'Saira Condensed' },
    // per-panel overrides: { [panelId]: { anchor: 'tl'|'tc'|'tr'|'cl'|'cc'|'cr'|'bl'|'bc'|'br', x, y, scale, hidden } }
    // `all` applies to every camera; a camera id key (e.g. `cockpit`) overrides it for that view only
    layouts: { all: {} },
  },
};
