// Loading screen settings: the model slot, and the knobs worth turning.

/**
 * The helmet the loading screen flies into: a .glb (or .gltf) under /public.
 * Drop another model at this path, or point this somewhere else. It is centred
 * and scaled to fit on its own; meshopt-packed files work, Draco ones do not.
 */
export const HELMET_MODEL_PATH = 'models/helmet.glb';

/**
 * How the visor is found. Any mesh whose node name or material name matches
 * becomes the tinted glass the camera flies through, and the model is turned
 * so that glass faces the viewer. In Blender, name the visor object "Visor".
 * With no match the helmet still shows, and the screen lifts with a plain fade.
 */
export const VISOR_PATTERN = /visor|glass|shield/i;

/** Milliseconds. */
export const TIMING = {
  minShow: 1400, // the screen stays up at least this long, so it never just flashes
  maxWait: 5000, // ...and lifts after this long, whatever is still loading
  helmetWait: 3500, // how long to wait for the helmet before going on without it
  helmetHold: 900, // the helmet floats at least this long before the camera leaves
  settle: 260, // the readout reaches 100% before anything moves
  anticipation: 420, // the pull-back
  dive: 1250, // the push through the visor
};

export const LOOK = {
  fov: 30, // a long lens, so the helmet is not distorted at rest
  exposure: 1.12,

  // Rim lights, as directions from the helmet toward each light. The camera
  // sits on +z, so a negative z puts a light behind the helmet.
  mars: { color: '#ff6a2c', intensity: 7.5, direction: [-0.82, 0.16, -0.55] }, // low sun through dust
  starlight: { color: '#a9c6ff', intensity: 3.2, direction: [0.74, 0.46, -0.5] },
  ambient: 0.55, // how much of the painted Martian dusk lights the shell

  glass: {
    tint: '#0d0705', // the smoked glass itself
    mirror: 0.5, // reflection strength when looked at straight on (edges always reflect fully)
  },

  rest: { yaw: 0, pitch: 0 }, // radians: the helmet waits facing the viewer squarely
  float: { amplitude: 0.055, period: 5.2 }, // rise and fall, in helmet heights x2 and seconds
  pullBack: 0.11, // anticipation: share of the camera distance, and
  shrink: 0.05, //   share of the helmet's size

  // The dive, as shares of TIMING.dive.
  revealAt: 0.42, // the glass starts to clear, and the page underneath wakes up
  clearBy: 0.9, // the glass is gone
  fadeFrom: 0.8, // whatever is still on screen fades out from here
  stopShort: 0.035, // how close the camera gets to the glass, as a share of the helmet's size

  // The rush: the lens opens up as the camera charges in.
  squeeze: 0.9, // the lens narrows to this share of `fov` during the pull-back...
  diveFov: 74, // ...then opens to this wide an angle (degrees) on the way in
  shake: 0.003, // radians of slow camera sway at the peak of the charge (0 for none)
  vignette: 0.5, // how dark the edges of the frame are (0 to 1); deepens with speed

  // The stars, in helmet sizes per second.
  drift: 0.6, // the slow float toward the viewer while waiting
  rush: 34, // top speed during the dive
  shutter: 0.05, // trail length, as seconds of motion (longer = longer streaks)

  // The pointer. The camera leans after it (helmet sizes) and the helmet turns toward it (radians).
  follow: { lean: 0.07, turn: 0.14 },
};
