// The look the design tools change: cameras, car body, HUD theme and HUD layout.
// T opens the tweak panel, L the HUD layout mode. Edits are saved in localStorage (`gridline.design`);
// to make a design the permanent default, export it from the panel and paste it over this object.
// Car coordinates are metres in car space: +x forward, +y up, +z toward the driver's right.
export const DESIGN_DEFAULTS = {
  version: 3,
  // Camera modes, cycled with C / Y. back/side/height/ahead/lookY are metres relative to the car.
  // k = follow stiffness, rigid = no smoothing, cockpitBody = player car shows its cockpit-view parts.
  cameras: [
    { id: 'chase',   label: 'Chase',   back: 9.5,  side: 0, height: 3.3,  ahead: 7,  lookY: 1.1, k: 7,  near: 0.5,  fov: 60, fovGain: 14, lean: 0,     rigid: false, cockpitBody: false },
    { id: 'cockpit', label: 'Cockpit', back: 0.12, side: 0, height: 1.08, ahead: 30, lookY: 0.8, k: 30, near: 0.12, fov: 56, fovGain: 10, lean: 0.035, rigid: true,  cockpitBody: true },
    { id: 'high',    label: 'High',    back: 16,   side: 0, height: 7,    ahead: 10, lookY: 0.5, k: 4,  near: 0.5,  fov: 60, fovGain: 14, lean: 0,     rigid: false, cockpitBody: false },
  ],
  car: {
    // shape + size: box [length, height, width] · rounded (box with rounded y-z corners, + radius) · sphere [radius]
    //   · cylinder [radius, length] (axis = y) · torus [radius, tube, arc°]
    // color: body | accent | dark | tyre | '#rrggbb'.  show: always | outside (hidden in cockpit view) | cockpit (only there) | off
    // steer: part of the steering wheel: positioned relative to the wheel centre (steering.pivot), moves/tilts/scales with
    //   the wheel and turns with the steering input.  Omitted fields: rot [0,0,0], show always, steer false.
    parts: [
      { name: 'tub rear',         shape: 'box', size: [1.85, 0.42, 0.72], pos: [-0.475, 0.45, 0],  color: 'body' },
      { name: 'tub front',        shape: 'box', size: [1.2, 0.3, 0.6],    pos: [1.0, 0.39, 0],     color: 'body' },
      { name: 'nose',             shape: 'box', size: [1.5, 0.24, 0.42],  pos: [2.25, 0.36, 0],    color: 'body' },
      { name: 'nose tip',         shape: 'box', size: [0.4, 0.18, 0.28],  pos: [3.05, 0.3, 0],     color: 'accent' },
      { name: 'front wing',       shape: 'box', size: [0.5, 0.05, 1.95],  pos: [3.05, 0.14, 0],    color: 'accent' },
      { name: 'front endplate R', shape: 'box', size: [0.5, 0.25, 0.04],  pos: [3.05, 0.2, 0.97],  color: 'body' },
      { name: 'front endplate L', shape: 'box', size: [0.5, 0.25, 0.04],  pos: [3.05, 0.2, -0.97], color: 'body' },
      { name: 'sidepod R',        shape: 'box', size: [1.7, 0.38, 0.42],  pos: [-0.1, 0.42, 0.58], color: 'body' },
      { name: 'sidepod L',        shape: 'box', size: [1.7, 0.38, 0.42],  pos: [-0.1, 0.42, -0.58], color: 'body' },
      { name: 'engine cover',     shape: 'box', size: [1.5, 0.4, 0.42],   pos: [-0.95, 0.74, 0],   color: 'body' },
      { name: 'airbox',           shape: 'box', size: [0.5, 0.36, 0.32],  pos: [-0.05, 0.92, 0],   color: 'dark' },
      { name: 'rear wing',        shape: 'box', size: [0.5, 0.07, 1.3],   pos: [-2.1, 1.05, 0],    color: 'accent' },
      { name: 'rear wing lower',  shape: 'box', size: [0.42, 0.05, 1.3],  pos: [-2.05, 0.88, 0],   color: 'accent' },
      { name: 'rear endplate R',  shape: 'box', size: [0.6, 0.6, 0.04],   pos: [-2.08, 0.82, 0.66], color: 'body' },
      { name: 'rear endplate L',  shape: 'box', size: [0.6, 0.6, 0.04],   pos: [-2.08, 0.82, -0.66], color: 'body' },
      { name: 'wing pillar',      shape: 'box', size: [0.12, 0.5, 0.12],  pos: [-1.85, 0.75, 0],   color: 'dark' },
      { name: 'diffuser',         shape: 'box', size: [0.7, 0.18, 1.3],   pos: [-1.9, 0.25, 0],    color: 'dark' },
      // the driver's helmet and the halo sit around the eye point, so they are hidden in cockpit view
      { name: 'helmet',           shape: 'sphere', size: [0.2],            pos: [0.55, 0.78, 0],   color: 'accent', show: 'outside' },
      { name: 'halo',             shape: 'torus', size: [0.34, 0.035, 180], pos: [0.62, 0.78, 0], rot: [-90, 0, 90], color: 'dark', show: 'outside' },
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
    ],
    wheels: [
      { name: 'front right', pos: [1.75, 0.36, 0.86],   radius: 0.36, width: 0.36, front: true },
      { name: 'front left',  pos: [1.75, 0.36, -0.86],  radius: 0.36, width: 0.36, front: true },
      { name: 'rear right',  pos: [-1.55, 0.38, 0.88],  radius: 0.38, width: 0.46, front: false },
      { name: 'rear left',   pos: [-1.55, 0.38, -0.88], radius: 0.38, width: 0.46, front: false },
    ],
    // the steering wheel as one unit (every steer part + the screen): pivot = its centre in car space,
    // rot = degrees (z + leans the top toward the driver), scale = [x, y, z] stretch, lock = degrees turned at full input
    steering: { pivot: [0.45, 0.86, 0], rot: [0, 0, 0], scale: [1, 1, 1], lock: 90 },
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
