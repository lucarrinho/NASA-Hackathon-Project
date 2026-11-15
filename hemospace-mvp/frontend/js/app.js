/* ==========================================================================
   HemoSpace v1.0 — app.js  [Dev 1 · Orchestrator]

   Responsibilities:
   - Global state (window.HemoState)
   - Gravitational environment switching (0g / 1/6g / 3/8g / 1g)
   - Demo Scenario A / B / C buttons
   - Bottom module tab switching
   - Flow: collection -> ApiClient.postReading(payload) (Dev 5)
            -> BodyMap.render(zones, gravity)       (Dev 3)
            -> ClinicalPanel.render(zone, data)     (Dev 4)

   Contract with the other modules: see README.md at the project root.
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------ constants
  const ZONE_KEYS = ['head_neck', 'thorax_heart', 'upper_limbs', 'lower_limbs'];

  // IDs of the anatomical SVG groups (Dev 3) for each zone
  const SVG_ZONE_IDS = {
    head_neck: 'zone-head',
    thorax_heart: 'zone-thorax',
    upper_limbs: 'zone-arms',
    lower_limbs: 'zone-legs'
  };

  // JSON contract status -> CSS class
  const STATUS_CLASS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };
  const ALL_STATUS_CLASSES = Object.values(STATUS_CLASS);

  const GRAVITIES = ['0G_ORBIT', '1_6G_MOON', '3_8G_MARS', '1G_EARTH'];

  // If true and ApiClient.loadPreset exists, the A/B/C buttons call
  // POST /api/v1/demo/preset/{code}. By default the spec §5 values are
  // filled into the form and sent via postReading (works offline).
  const USE_BACKEND_PRESETS = false;

  // Validated scenarios (spec §5). ultrasoundPreset uses the same data-sample ids as Tab 3.
  const PRESETS = {
    A: { gravityProfile: '0G_ORBIT',  armSys: 118, armDia: 76, ankleSys: 112, hr: 68, calf: 0.0,  ultrasoundPreset: 'jugular_normal'  },
    B: { gravityProfile: '0G_ORBIT',  armSys: 138, armDia: 88, ankleSys: 108, hr: 84, calf: 0.0,  ultrasoundPreset: 'jugular_dilated' },
    C: { gravityProfile: '3_8G_MARS', armSys: 96,  armDia: 68, ankleSys: 84,  hr: 98, calf: -2.4, ultrasoundPreset: 'NONE'            }
  };

  // ------------------------------------------------------------------ global state
  const S = (window.HemoState = {
    astronautId: 'AST-04',
    missionDay: 42,
    gravityProfile: '0G_ORBIT',
    selectedZone: 'head_neck',
    panelOpen: true,            // right panel (regional diagnosis) open/closed
    data: null,                 // latest AstronautStateResponse
    lastPayload: null,          // latest ReadingRequest sent
    activePreset: null,         // 'A' | 'B' | 'C' | null
    offline: false,
    busy: false,
    // Filled by the capture modules (Dev 5 / Dev 6):
    ppgCapillaryRefillSec: 1.5, // inputs.js updates after the optical reading
    ultrasoundPreset: 'NONE'    // ultrasound.js: 'jugular_normal' | 'jugular_dilated' | 'femoral_reduced' | 'NONE'
  });

  const $ = (id) => document.getElementById(id);
  let requestSeq = 0;
  const warned = {};

  // ------------------------------------------------------------------ utilities
  /** Calls window[moduleName][method] without crashing the app if the module does not exist yet or fails. */
  function callModule(moduleName, method, ...args) {
    const mod = window[moduleName];
    if (!mod || typeof mod[method] !== 'function') {
      const key = moduleName + '.' + method;
      if (!warned[key]) {
        warned[key] = true;
        console.warn('[HemoSpace] ' + key + ' not available yet (merge pending).');
      }
      return;
    }
    try {
      mod[method](...args);
    } catch (err) {
      console.error('[HemoSpace] error in ' + moduleName + '.' + method, err);
    }
  }

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  let toastTimer = null;
  function showToast(message) {
    let el = $('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'alert');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
  }

  function readNumber(id) {
    const el = $(id);
    if (!el || el.value.trim() === '') return NaN;
    return Number(el.value);
  }

  function setInputValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ------------------------------------------------------------------ payload (ReadingRequest)
  function buildPayload() {
    const form = $('manual-reading-form');
    if (form && !form.checkValidity()) {
      switchTab('tab-manual'); // the form must be visible to show the error
      form.reportValidity();
      return null;
    }

    const payload = {
      astronautId: S.astronautId,
      gravityProfile: S.gravityProfile,
      armSystolicMmhg: readNumber('input-arm-sys'),
      armDiastolicMmhg: readNumber('input-arm-dia'),
      ankleSystolicMmhg: readNumber('input-ankle-sys'),
      heartRateBpm: readNumber('input-hr'),
      calfCircumferenceCm: readNumber('input-calf'),
      ppgCapillaryRefillSec: Number(S.ppgCapillaryRefillSec),
      ultrasoundPreset: S.ultrasoundPreset || 'NONE'
    };

    const invalid = Object.keys(payload).filter((k) => typeof payload[k] === 'number' && Number.isNaN(payload[k]));
    if (invalid.length) {
      showToast('Fill in all numeric fields in Tab 1.');
      return null;
    }
    return payload;
  }

  // ------------------------------------------------------------------ diagnosis
  function setBusy(busy) {
    S.busy = busy;
    const btn = $('btn-update-diagnosis');
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.disabled = busy;
    btn.textContent = busy ? 'Updating…' : btn.dataset.label;
  }

  /**
   * Runs a diagnosis request and distributes the result.
   * Stale responses (rapid clicks) are discarded.
   */
  async function requestDiagnosis(fetcher, payload) {
    const seq = ++requestSeq;
    setBusy(true);
    try {
      const data = await fetcher();
      if (seq !== requestSeq) return;
      if (!data || !data.zones) throw new Error('Response without the "zones" object.');
      if (payload) S.lastPayload = payload;
      applyResponse(data);
    } catch (err) {
      if (seq !== requestSeq) return;
      console.error('[HemoSpace] failed to update diagnosis', err);
      showToast('Failed to update the diagnosis: ' + (err && err.message ? err.message : err));
    } finally {
      if (seq === requestSeq) setBusy(false);
    }
  }

  function runDiagnosis() {
    const payload = buildPayload();
    if (!payload) return Promise.resolve();
    if (!window.ApiClient || typeof window.ApiClient.postReading !== 'function') {
      showToast('ApiClient.postReading not found (js/api.js).');
      return Promise.resolve();
    }
    return requestDiagnosis(() => window.ApiClient.postReading(payload), payload);
  }

  // ------------------------------------------------------------------ rendering
  function applyResponse(data) {
    S.data = data;

    if (data.gravity_profile && GRAVITIES.includes(data.gravity_profile)) {
      S.gravityProfile = data.gravity_profile;
      syncGravityButtons();
    }
    if (data.astronaut_id) S.astronautId = data.astronaut_id;
    if (data.mission_day) S.missionDay = data.mission_day;

    updateTopbar();
    setConnStatus(data._offline === true);
    updateCards(data.zones);

    callModule('BodyMap', 'render', data.zones, data.gravity_profile || S.gravityProfile);
    callModule('ClinicalPanel', 'render', S.selectedZone, data);
    highlightSelected();
  }

  function updateTopbar() {
    const info = $('astronaut-info');
    if (info) info.textContent = 'Crew member: ' + S.astronautId + ' (Day ' + S.missionDay + ')';
  }

  function updateCards(zones) {
    ZONE_KEYS.forEach((key) => {
      const card = $('card-' + key);
      const zone = zones && zones[key];
      if (!card || !zone) return;
      card.classList.remove(...ALL_STATUS_CLASSES);
      const cls = STATUS_CLASS[zone.status];
      if (cls) card.classList.add(cls);
      const label = card.querySelector('.zone-status-label');
      if (label) label.textContent = zone.label || zone.status;
      card.title = zone.action || '';
    });
  }

  function highlightSelected() {
    ZONE_KEYS.forEach((key) => {
      const on = S.panelOpen && key === S.selectedZone;
      const card = $('card-' + key);
      if (card) card.classList.toggle('selected', on);
      const svgZone = $(SVG_ZONE_IDS[key]);
      if (svgZone) svgZone.classList.toggle('selected', on);
    });
  }

  function setConnStatus(offline) {
    S.offline = !!offline;
    let el = $('conn-status');
    if (!el) {
      const host = document.querySelector('.brand-info');
      if (!host) return;
      el = document.createElement('span');
      el.id = 'conn-status';
      el.className = 'conn-status';
      host.appendChild(el);
    }
    el.classList.toggle('offline', S.offline);
    el.classList.toggle('online', !S.offline);
    el.textContent = S.offline ? 'Offline mode (local calculation)' : 'Java API online';
  }

  // ------------------------------------------------------------------ selected zone
  /** Called by bodymap.js (SVG click) and by the index.html cards. */
  function selectZone(zoneKey) {
    if (!ZONE_KEYS.includes(zoneKey)) {
      console.warn('[HemoSpace] unknown zone:', zoneKey);
      return;
    }
    // Clicking the already-open region closes the panel; any other click opens it.
    const closing = S.panelOpen && zoneKey === S.selectedZone;
    S.selectedZone = zoneKey;
    setPanelOpen(!closing);
    highlightSelected();
    if (!closing && S.data) callModule('ClinicalPanel', 'render', zoneKey, S.data);
    emit('hemospace:zone', { zoneKey: closing ? null : zoneKey });
  }

  /** Closes the diagnosis panel via the X button (same effect as clicking the open region again). */
  function closePanel() {
    if (!S.panelOpen) return;
    const key = S.selectedZone;
    setPanelOpen(false);
    highlightSelected();
    emit('hemospace:zone', { zoneKey: null });
    const card = $('card-' + key);
    if (card) card.focus(); // keyboard users keep their place
  }

  /** Shows/hides the regional diagnosis panel and lets the body map use the free space. */
  function setPanelOpen(open) {
    S.panelOpen = !!open;
    const panel = $('clinical-panel');
    if (panel) panel.hidden = !S.panelOpen;
    const grid = document.querySelector('.main-grid');
    if (grid) grid.classList.toggle('panel-collapsed', !S.panelOpen);
    ZONE_KEYS.forEach((key) => {
      const card = $('card-' + key);
      if (card) card.setAttribute('aria-expanded', String(S.panelOpen && key === S.selectedZone));
    });
  }

  // ------------------------------------------------------------------ gravity
  function syncGravityButtons() {
    document.querySelectorAll('.grav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.gravity === S.gravityProfile);
    });
  }

  function setGravity(gravityProfile, opts) {
    if (!GRAVITIES.includes(gravityProfile)) return;
    const silent = opts && opts.silent;
    S.gravityProfile = gravityProfile;
    syncGravityButtons();
    emit('hemospace:gravity', { gravityProfile });
    if (!silent) {
      S.activePreset = null;
      syncDemoButtons();
      runDiagnosis();
    }
  }

  // ------------------------------------------------------------------ demo scenarios
  function syncDemoButtons() {
    document.querySelectorAll('.demo-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === S.activePreset);
    });
  }

  function applyPreset(code) {
    const p = PRESETS[code];
    if (!p) return Promise.resolve();

    S.activePreset = code;
    syncDemoButtons();
    setGravity(p.gravityProfile, { silent: true });

    setInputValue('input-arm-sys', p.armSys);
    setInputValue('input-arm-dia', p.armDia);
    setInputValue('input-ankle-sys', p.ankleSys);
    setInputValue('input-hr', p.hr);
    setInputValue('input-calf', p.calf.toFixed(1));
    S.ultrasoundPreset = p.ultrasoundPreset;

    emit('hemospace:preset', { code, ultrasoundPreset: p.ultrasoundPreset });
    switchTab('tab-manual'); // presenter sees the injected numbers

    const payload = buildPayload();
    if (!payload) return Promise.resolve();

    if (USE_BACKEND_PRESETS && window.ApiClient && typeof window.ApiClient.loadPreset === 'function') {
      return requestDiagnosis(() => window.ApiClient.loadPreset(code), payload);
    }
    if (!window.ApiClient || typeof window.ApiClient.postReading !== 'function') {
      showToast('ApiClient.postReading not found (js/api.js).');
      return Promise.resolve();
    }
    return requestDiagnosis(() => window.ApiClient.postReading(payload), payload);
  }

  // ------------------------------------------------------------------ tabs
  function switchTab(tabId) {
    const target = $(tabId);
    if (!target) return;
    document.querySelectorAll('#multimodal-module .tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('#multimodal-module .tab-content').forEach((el) => {
      const on = el.id === tabId;
      el.hidden = !on;
      el.classList.toggle('active', on);
    });
    emit('hemospace:tab', { tab: tabId }); // inputs.js can turn the webcam on/off here
  }

  // ------------------------------------------------------------------ initialization
  function decorateCards() {
    // keyboard accessibility on the cards (without touching the shared HTML)
    ZONE_KEYS.forEach((key) => {
      const card = $('card-' + key);
      if (!card) return;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-controls', 'clinical-panel');
      card.setAttribute('aria-expanded', String(S.panelOpen && key === S.selectedZone));
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          selectZone(key);
        }
      });
    });
  }

  function bindEvents() {
    const closeBtn = $('panel-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    document.querySelectorAll('.grav-btn').forEach((btn) => {
      btn.addEventListener('click', () => setGravity(btn.dataset.gravity));
    });
    document.querySelectorAll('.demo-btn').forEach((btn) => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });
    document.querySelectorAll('#multimodal-module .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const update = $('btn-update-diagnosis');
    if (update) {
      update.addEventListener('click', () => {
        S.activePreset = null;
        syncDemoButtons();
        runDiagnosis();
      });
    }

    const form = $('manual-reading-form');
    if (form) {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault(); // Enter in the form does not reload the page
        S.activePreset = null;
        syncDemoButtons();
        runDiagnosis();
      });
    }
  }

  function init() {
    decorateCards();
    bindEvents();
    syncGravityButtons();
    highlightSelected();
    updateTopbar();
    runDiagnosis(); // initial state: form default values (= Scenario A)
  }

  // Public API (globals required by the spec + debugging shortcuts)
  window.selectZone = selectZone;
  window.HemoApp = { runDiagnosis, applyPreset, setGravity, selectZone, setPanelOpen, closePanel, switchTab, showToast, PRESETS };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
