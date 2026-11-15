// How it works: the station markers fill in as the progress line reaches them.
// Station positions along the line: start of each of the three columns.
const STATIONS = [0.02, 0.345, 0.69];

export function initJourney(section, { reduced }) {
  if (!section) return;
  if (reduced) {
    section.dataset.reached = '3';
    section.style.setProperty('--progress', '1');
    return;
  }
  section.addEventListener('progress', (e) => {
    const reached = String(STATIONS.filter((s) => e.detail >= s).length);
    if (section.dataset.reached !== reached) section.dataset.reached = reached;
  });
}
