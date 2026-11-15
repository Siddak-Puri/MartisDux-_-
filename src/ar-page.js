import '@google/model-viewer';
import qrcode from 'qrcode-generator';
import { phoneUrl } from './phone-link.js';
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/martian-mono/wght.css';
import './ar-page.css';

const $ = id => document.getElementById(id);
if (window !== window.top) document.documentElement.classList.add('embedded');
const viewer = $('model');
let info = null;

function hotspots(relief) {
  viewer.querySelectorAll('.ar-hotspot').forEach(el => el.remove());
  for (const a of info.models[relief].anchors) {
    const el = document.createElement('button');
    el.className = `ar-hotspot ar-hotspot-${a.id === 'base' ? 'base' : a.id === 'dest' ? 'dest' : 'sci'}`;
    el.slot = `hotspot-${a.id}`; el.type = 'button';
    el.dataset.position = a.position.join(' '); el.dataset.normal = '0 1 0';
    el.innerHTML = '<span></span>'; el.querySelector('span').textContent = a.label;
    if (a.detail) el.title = `${a.label}: ${a.detail}`;
    viewer.append(el);
  }
}

function setRelief(relief) {
  document.querySelectorAll('[data-relief]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.relief === relief)));
  viewer.src = info.models[relief].file;
  viewer.setAttribute('ios-src', info.models[relief].file.replace(/\.glb$/, '.usdz'));
  hotspots(relief);
  $('ar-note').textContent = relief === 'x1'
    ? `True vertical scale. This ${info.areaMetres[0]} × ${info.areaMetres[1]} m patch of crater floor has ${info.reliefMetres} m of relief, so at 1:${info.scale.split(':')[1]} it looks almost flat — as it would to an astronaut.`
    : `Heights exaggerated three times so the gentle slopes are easy to see. Horizontal scale ${info.scale}.`;
}

fetch('jezero-marswalk.json').then(r => r.json()).then(data => {
  info = data;
  $('ar-scale').textContent = data.scale;
  $('ar-distance').textContent = `${data.route.distance} m`;
  $('ar-slope').textContent = `${data.route.maxSlope}°`;
  setRelief('x1');
});
document.querySelectorAll('[data-relief]').forEach(b => b.addEventListener('click', () => setRelief(b.dataset.relief)));
viewer.addEventListener('progress', e => { $('ar-progress').style.width = `${Math.round(e.detail.totalProgress * 100)}%`; });

const mobile = matchMedia('(pointer: coarse)').matches;
if (!mobile) {
  $('ar-qr').hidden = false;
  phoneUrl().then(url => {
    if (!url) {
      $('ar-qr').classList.add('ar-qr-off');
      $('ar-qr-text').innerHTML = '<b>Phone AR needs a network</b>Connect this laptop to Wi-Fi (or a phone hotspot), then reopen this view to get a QR code.';
      return;
    }
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    $('ar-qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    $('ar-qr-url').textContent = url;
  });
}
