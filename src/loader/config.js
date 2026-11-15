export const HELMET_MODEL_PATH = 'models/helmet.glb';

export const VISOR_PATTERN = /visor|glass|shield/i;

export const TIMING = {
  minShow: 1400,
  helmetWait: 3500,
  arrival: 1200,
  settle: 260,
  anticipation: 420,
  dive: 1250,
};

export const LOOK = {
  fov: 30,
  exposure: 1.12,

  mars: { color: '#ff6a2c', intensity: 7.5, direction: [-0.82, 0.16, -0.55] },
  starlight: { color: '#a9c6ff', intensity: 3.2, direction: [0.74, 0.46, -0.5] },
  ambient: 0.55,

  glass: {
    tint: '#0d0705',
    mirror: 0.5,
  },

  rest: { yaw: 0, pitch: 0 },
  float: { amplitude: 0.055, period: 5.2 },
  pullBack: 0.11,
  shrink: 0.05,

  revealAt: 0.42,
  clearBy: 0.9,
  fadeFrom: 0.8,
  stopShort: 0.035,

  squeeze: 0.85,
  diveFov: 100,
  streaks: 1,
  shake: 0.006,
};
