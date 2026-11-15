# MartisDux: The Ultimate Martian Navigator Out there

NASA Space Apps 2026 · *Interplanetary Survival Guide: Martian Map* · Team MartisDux

From Mars, a question to Houston and its answer take about 22 minutes right now.
A suit leak or a solar storm will not wait. MartisDux is a Mars map that makes the
flight controller's calls itself: GO/NO-GO before a Marswalk, and the way home the
moment something goes wrong. It runs as a desktop app with NASA and partner data.

## Try it in two minutes

1. Open the **official website** at https://www.martisdux.com. In the Simulator
   section, choose the download for Windows (`.exe`) or macOS (`.dmg`) and open
   the file to start the app. The macOS app is not signed with an Apple Developer
   ID: if macOS blocks it, open **System Settings → Privacy & Security** and
   choose **Open Anyway** (on older macOS, right-click the app and choose **Open**).
2. Choose **Walk** and select **Sample walk at Jezero**. For a harder case,
   select **Try selecting point A and point B on Mars**.
3. The **GO/NO-GO poll** fills in: route, ground, suit, way home, daylight, solar
   storms, body, radio.
4. Press **Start the walk**, then **Solar storm**, **Suit leak** or **Injury**. The
   app gives the call, draws the fastest way home and counts down.
5. Turn on **Storm shelter** (bottom bar) to see where terrain hides the sky, and
   **Rover check** to see the slope map tested against Perseverance.
6. In **Walk**, choose **Stand in Jezero with the helmet display** to walk the
   Perseverance landing site at life size from an astronaut's point of view. The
   visor shows heading, slope and turn cues along the reference route.
7. After selecting two points on the map, scroll down in the Walk panel and press
   **Walk it in 3D** to follow your route in first person.
8. With two points selected, you can also download the traverse sheet:

<img width="1440" height="900" alt="Traverse sheet" src="https://github.com/user-attachments/assets/70983982-98b4-438a-92a5-a12585cd06f7" />

9. Choose **Log** in the left panel to simulate reporting a finding to Earth.
10. The time a message takes to travel between Mars and Earth is calculated by:

<p align="center"><b>One-way light time (seconds) = d ÷ c</b></p>

Where:
* **d** = current distance between Earth and Mars (in kilometres)
* **c** = speed of light in a vacuum (299,792.458 km/s)

Plan your own walk with **Walk**: pick a start and a destination on the map, or try the
sample walks there: a short one, the 3 km delta front, a climb onto the delta, the crater
rim by rover (GO) and on foot (NO-GO), and Curiosity's first drive at Gale.

## What is measured, not just shown

| Check | Result | Reproduce |
|---|---|---|
| Slope map vs Perseverance's measured tilt, 588 waypoints | mean error 1.5° (no-skill 4.6°), r = 0.91 | `python scripts/validate-perseverance.py` |
| Same test, Curiosity on Mount Sharp, 1,344 waypoints | 2.7° (no-skill 3.6°), r = 0.68 | `python scripts/validate-curiosity.py` |
| Rover path on ground the map calls steep | avoided about 30× vs the surrounding corridor | `node scripts/validate-routes.mjs` |
| Sky hidden by terrain at Curiosity's Quela site | 19.3% from orbit vs 19% measured by the RAD team | `python scripts/validate-rad-shielding.py` |
| Earth–Mars radio delay | 11 min 22 s on Perseverance's landing day (NASA's figure) | `npm test` |

Methods, exact sources and limits for every dataset: [DATA-SOURCES.md](DATA-SOURCES.md).

## Features

- Layered Mars globe: Viking colour, CTX, HiRISE, THEMIS infrared, MOLA relief, USGS geology.
- Slope hazards and the safest walking route on 1 m HiRISE elevation (Jezero, Gale).
- Marswalk plan: suited walking time, energy, oxygen, radiation dose, daylight, an
  8 h suit budget with a reserve, and a walk-back field that knows the fastest way
  home from every point.
- GO/NO-GO poll, live walk console and emergency drills.
- Storm shelter map (sky hidden by terrain) and live NASA DONKI solar storm forecasts.
- Rover mode with Apollo's walkback limit.
- Numbered traverse stations with the USGS 1:75,000 Jezero rock unit and a real
  Perseverance photo of each spot; **Traverse sheet** saves a one-page PDF to the Desktop.
- First-person walk along the route with a helmet display; rover 360° panoramas.
- Life-size walk at the Perseverance landing site with a visor display (desktop
  preview, Android AR, VR headsets).
- Discovery log with a simulated downlink to Houston at the real light time.
- Works without internet for everything bundled; viewed map tiles are kept on the device.

## Build from source

Needs Node.js 22 or newer. Python 3 (NumPy, requests) is only needed to regenerate data.

```sh
npm ci
npm test            # 120 automated checks, including the validation statistics
npm run app         # build and open the desktop app
npm run app:dist    # portable .exe and installer into release/
npm run dev         # browser development server
```

Live solar storm data uses NASA's public DONKI API. It works with the shared demo
key; for a higher request limit copy `.env.example` to `.env` and add a key from
https://api.nasa.gov.

macOS packages (Apple Silicon and Intel, ad-hoc signed, into `release/`):

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run app:mac -- -c.mac.identity=- -c.mac.hardenedRuntime=false
```

This local command produces ad-hoc signed apps and DMGs under `release/`.
The macOS bundles declare macOS 13.0 as their minimum version. For distribution,
sign with a Developer ID Application identity and Apple notarization credentials.

## Discovery log

Open **Log** to record a discovery, attach a Mars position, and save a draft.
**Ship to Houston** simulates a one-way downlink with a countdown based on
the app's JPL light-time model. The simulation and its history are stored on
this device. **Record observation** in the first-person view captures your
current position for the form.

## Life-size walk with a visor display

`ar/walk.html` (opened from **Walk** in the app) puts you at the Perseverance landing
site at 1:1 on the Mars sphere. The walkable 2 × 2 km is NASA's native 1 m HiRISE
elevation model with 0.32 m/px HiRISE imagery; beyond it the ground continues on
coarser measured data (CTX, HRSC/MOLA, Viking) out to the crater rim and the horizon.
The visor shows heading, the steepest slope in an 80 m scan of the raw elevation
data, ground elevation, distance and turn cues along the reference route, a simulated
suit budget and the live NASA DONKI solar storm forecast. Readouts with no data
behind them say so: radiation shows "Unknown".

Three things are display choices, each labelled in the start menu and switchable:
heights are shown ×2 by default (key **V** for true scale), pebbles and fine ground
texture within 30 m are illustrative (key **G**), and the monochrome orbital images
are tinted with one average Mars colour. Keys: **W A S D** to walk, **H** cycles the
display (full, compact, hidden), **Esc** opens the menu.

On a phone it needs HTTPS: `npm run build:ar-site`, host `dist-ar/`, open `walk.html`
in Chrome on an ARCore Android phone and choose **Enter AR**. AR and VR sessions on
real devices have not been tested yet; the desktop preview has.

## Layout

- `src/` app code. Pure, tested models: `eva.js` (walking, energy, walk-back field),
  `mission-control.js` (timeline, way home, line of sight, drills), `earth-link.js`
  (radio delay), `hazards.js` (slope, routing). `*.test.js` are the tests.
- `scripts/` data preparation and validation (Python and Node).
- `public/data/` prepared NASA data used by the app.
- `electron/` desktop wrapper; `server/` device tile cache.

## Credits

Imagery and data: NASA, JPL-Caltech, USGS, University of Arizona, MSSS, ASU, ESA/DLR/FU
Berlin and others, listed in DATA-SOURCES.md. Independent student project; no NASA
endorsement is implied. Planning numbers are estimates, not flight rules.
