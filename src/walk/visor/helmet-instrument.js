import {helmetReadout} from './helmet-profile.js';

const sentence = value => value.charAt(0) + value.slice(1).toLowerCase();
const directions = ['N', 'E', 'S', 'W'];

export function helmetInstrument(state) {
  const readout = helmetReadout(state);
  const ticks = [];
  if (readout.heading !== null) {
    const first = Math.ceil((readout.heading - 40) / 5) * 5;
    for (let bearing = first; bearing <= readout.heading + 40; bearing += 5) {
      const degrees = (bearing + 360) % 360;
      ticks.push({
        position: (bearing - readout.heading + 40) / 80,
        major: degrees % 10 === 0,
        label: degrees % 90 === 0 ? directions[degrees / 90] : degrees % 20 === 0 ? String(degrees).padStart(3, '0') : '',
      });
    }
  }
  const slope = state?.hazard?.slope;
  const quiet = readout.level === 'low' && Number.isFinite(slope);
  return {
    ...readout,
    ticks,
    status: ({ar:'AR tracking', vr:'VR tracking', waiting:'Waiting for pose', stale:'Tracking lost'})[state?.mode] || 'Simulation',
    terrain: quiet ? `Max sampled slope ${slope.toFixed(1)}°` : sentence(readout.warning),
    terrainDetail: quiet ? `${Math.round(state.hazard.distance || 80)} m scan` : readout.detail.replace('° grade', '° slope'),
    guidance: sentence(readout.guidance),
  };
}
