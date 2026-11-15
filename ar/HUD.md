# MartisDux helmet HUD — how to plug yours in

The life-size AR walk (`ar/walk.html`) shows real Jezero crater terrain at 1:1 around
the user (Android Chrome AR, or a first-person preview on a laptop). The HUD is a
**separate, replaceable layer** drawn on top of it. The current HUD in
`src/walk/hud.js` + `src/walk/hud.css` is a placeholder — replace it freely.

## Seeing it

```
npm run dev            → http://localhost:5173/ar/walk.html   (laptop preview: drag to look, WASD to walk)
npm run app            → desktop app → "Walk Jezero at life size"; scan the QR with an Android phone
```

## Option A — replace the placeholder (same tech: HTML/CSS/JS)

Edit or replace `src/walk/hud.js`. It must export one function:

```js
export function createHud(root /* HTMLElement, full screen */) {
  // build your DOM inside root
  return { update(state) { /* called every frame (~60×/s) with the walk state below */ } };
}
```

The HUD is an HTML layer, so in Android AR it is shown with WebXR **DOM Overlay**:
plain HTML/CSS/SVG/canvas all work. Keep it `pointer-events: none` unless something
must be tapped. Only touch the DOM when a value changes (see `set()` in the placeholder).

## Option B — HUD built some other way (React, Svelte, a canvas, …)

Every frame the walk also fires a DOM event with the same object:

```js
window.addEventListener('martisdux:state', e => draw(e.detail));
```

Mount your app into `#hud` (inside `#walk-overlay`, which is the AR overlay root —
anything outside it is invisible in AR).

## The `state` object

All distances in metres, angles in degrees. Local frame: `x` east, `z` south.

| field | meaning |
|---|---|
| `mode` | `'ar'` (phone AR) or `'preview'` |
| `time.sol`, `time.lmst`, `time.ltst` | Mars sol date, local mean / true solar time at Jezero (hours, 0–24), from the Mars24 algorithm |
| `time.ls`, `time.sunElevation`, `time.sunAzimuth` | season (solar longitude) and the real Sun position right now |
| `position.lat`, `position.lon`, `position.x`, `position.z` | where the astronaut stands |
| `elevation` | ground elevation (MOLA areoid, m; about −2,500 at Jezero) |
| `heading`, `pitch` | where the astronaut looks (0 = north, 90 = east); pitch + = up |
| `slope` | steepest ground slope underfoot (2 m baseline, 1 m HiRISE DTM) |
| `slopeAhead` | signed slope 5 m ahead in the look direction (+ uphill) |
| `slopeClass` | `{ id: 'easy'|'caution'|'steep'|'nogo', label }` — MartisDux walking classes (<10°, <20°, <30°, ≥30°) |
| `speed` | walking speed (m/s, smoothed) |
| `route.walked`, `route.remaining`, `route.length` | progress along the planned safe route (902 m) |
| `route.offRoute` | distance from the route |
| `route.turnToRoute` | turn needed to face the route 8 m ahead (+ = right) |
| `route.autoWalk` | 0 = off, else fast-forward factor (1×, 5×, 20×) |
| `next` | next sample site ahead: `{ name, detail, distance, bearing, turn }` (`turn` + = right; rotate an arrow by it) |
| `base` | `{ distance, bearing }` back to the landing site |
| `suit.evaSeconds` | EVA clock (fast-forward speeds it up too) |
| `suit.o2Percent`, `suit.o2Grams` | oxygen left: Pandolf metabolic model at Mars gravity (`src/eva.js`), tank sized for an 8 h EVA |
| `suit.doseMicroSv` | radiation dose so far at the Curiosity RAD surface rate (0.64 mSv/sol) |

Suit numbers are planning estimates from MartisDux's models (sources in `src/eva.js`),
not flight values — say so on screen if you show them.
