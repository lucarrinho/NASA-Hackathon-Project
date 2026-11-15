/* HemoSpace — DEV3: body map.
   Only presents the received state; computes nothing clinical.
   Contract: BodyMap.render(zones, gravityProfile) · click/Enter/Space -> window.selectZone(zoneKey)
   The selection class (.selected) and highlighting are applied by app.js (Dev1). */
(function () {
  'use strict';

  const ZONES = {
    head_neck: 'zone-head',
    thorax_heart: 'zone-thorax',
    upper_limbs: 'zone-arms',
    lower_limbs: 'zone-legs'
  };
  const STATUS_CLASSES = ['st-blue', 'st-green', 'st-amber', 'st-red'];
  const STATUS_TO_CLASS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };

  function paintZone(zoneKey, zoneData) {
    const el = document.getElementById(ZONES[zoneKey]);
    if (!el) return;
    el.classList.remove(...STATUS_CLASSES);
    const status = String((zoneData && zoneData.status) || '').toUpperCase();
    const cls = STATUS_TO_CLASS[status];
    if (cls) {
      el.classList.add(cls);
      el.dataset.status = status;
    } else {
      el.dataset.status = 'UNKNOWN';
      console.warn('BodyMap: missing/unknown status in "' + zoneKey + '":', zoneData && zoneData.status);
    }
    if (zoneData && zoneData.label) el.setAttribute('aria-label', zoneData.label);
  }

  // `hidden` is not reliable on SVG elements: the display attribute is used instead.
  function setShown(el, shown) {
    if (!el) return;
    if (shown) el.removeAttribute('display');
    else el.setAttribute('display', 'none');
  }

  // VISUAL GRAVITY RULE (simple proposal; validate with the team):
  //  - 0g: cephalic flow (arrow up, solid).
  //  - 1g: distal flow (arrow down, solid).
  //  - Moon (1/6g) and Mars (3/8g): gravity is still present, so the arrow points down as in 1g,
  //    but dashed and weaker, proportional to gravity (Mars > Moon). It is only a visual
  //    aid: it does not represent a measurement or a diagnosis.
  const GRAVITY_VIEW = {
    '0G_ORBIT':  { text: '0 g · cephalic flow',          arrow: 'up',   strength: 1,    partial: false },
    '1_6G_MOON': { text: '1/6 g · partial distal flow',  arrow: 'down', strength: 0.45, partial: true },
    '3_8G_MARS': { text: '3/8 g · partial distal flow',  arrow: 'down', strength: 0.7,  partial: true },
    '1G_EARTH':  { text: '1 g · distal flow',            arrow: 'down', strength: 1,    partial: false }
  };

  function updateFlowDirection(gravityProfile) {
    const view = GRAVITY_VIEW[gravityProfile];
    const up = document.getElementById('flow-up');
    const down = document.getElementById('flow-down');
    const label = document.getElementById('gravity-label');
    setShown(up, !!view && view.arrow === 'up');
    setShown(down, !!view && view.arrow === 'down');
    [up, down].forEach((el) => {
      if (!el) return;
      el.setAttribute('opacity', view ? String(view.strength) : '1');
      el.classList.toggle('flow-partial', !!view && view.partial);
    });
    if (label) label.textContent = view ? view.text : '';
  }

  // Visual speed only: cycle duration = 60 / bpm (does not classify the HR).
  function setHeartRate(heartRateBpm) {
    const heart = document.querySelector('#zone-thorax .heart-pulse');
    if (!heart) return;
    const bpm = Number(heartRateBpm);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      heart.classList.remove('is-beating');
      heart.style.removeProperty('--beat-duration');
      return;
    }
    heart.style.setProperty('--beat-duration', (60 / bpm) + 's');
    heart.classList.add('is-beating');
  }

  // HR: optional 3rd argument {heartRateBpm}; otherwise, the latest payload sent by app.js
  // (window.HemoState.lastPayload.heartRateBpm — field already present in ReadingRequest).
  function render(zonesData, gravityProfile, options) {
    if (!zonesData || typeof zonesData !== 'object') {
      console.warn('BodyMap: zone data missing or invalid.');
      return;
    }
    Object.keys(ZONES).forEach((key) => paintZone(key, zonesData[key]));
    updateFlowDirection(gravityProfile);

    let bpm;
    if (options && 'heartRateBpm' in options) bpm = options.heartRateBpm;
    else if (window.HemoState && window.HemoState.lastPayload) bpm = window.HemoState.lastPayload.heartRateBpm;
    setHeartRate(bpm);
  }

  function syncPressed(zoneKey) {
    Object.keys(ZONES).forEach((key) => {
      const el = document.getElementById(ZONES[key]);
      if (el) el.setAttribute('aria-pressed', String(key === zoneKey));
    });
  }

  function selectFromMap(zoneKey) {
    if (typeof window.selectZone === 'function') window.selectZone(zoneKey);
    else console.warn('BodyMap: window.selectZone is not available yet.');
  }

  function bindZoneEvents() {
    document.querySelectorAll('#body-map [data-zone]').forEach((el) => {
      if (el.dataset.bodymapBound === 'true') return;
      el.dataset.bodymapBound = 'true';
      const key = el.dataset.zone;
      el.addEventListener('click', () => selectFromMap(key));
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          selectFromMap(key);
        }
      });
    });
    // accessibility: reflects the selected zone (event emitted by app.js)
    document.addEventListener('hemospace:zone', (ev) => syncPressed(ev.detail && ev.detail.zoneKey));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindZoneEvents);
  else bindZoneEvents();

  window.BodyMap = { render, setHeartRate };
})();
