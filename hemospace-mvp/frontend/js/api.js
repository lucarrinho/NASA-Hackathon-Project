/* ==========================================================================
   HemoSpace v1.0 — api.js  [Dev 5 · API layer + offline fallback]

   Public contract (README):
     ApiClient.postReading(payload)  -> Promise<AstronautStateResponse>
     ApiClient.loadPreset(code)      -> Promise<AstronautStateResponse>   (A | B | C)
     ApiClient.getState(id)          -> Promise<AstronautStateResponse>
     ApiClient.classifyUltrasound({astronautId, region, ultrasoundPreset})
     ApiClient.computeLocal(payload) -> AstronautStateResponse (always with _offline: true)
     ApiClient.selfTest()            -> checks Scenarios A/B/C in the local engine (console)

   Rule 2: if Java does not respond within 500 ms (or goes down), compute locally.
   The LocalEngine below replicates HemodynamicService.java rule by rule.
   >>> If Dev 2 changes any threshold/text in Java, update LocalEngine as well. <<<

   Adaptations between the frontend and the ReadingRequest record (done only here):
   - ultrasoundPreset: 'jugular_normal' | 'jugular_dilated' | 'femoral_reduced' | 'NONE'
       -> 'NORMAL' | 'DILATED' | 'REDUCED' (Java rejects the Tab 3 ids).
   - calfCircumferenceCm: the form sends the VARIATION (e.g., -2.4); Java requires a
       non-negative value, so we send CALF_BASELINE_CM + variation.
   ========================================================================== */
(function () {
  'use strict';

  const BASE_URL = 'http://localhost:8080/api/v1';
  const TIMEOUT_MS = 500;         // Rule 2
  const WARMUP_TIMEOUT_MS = 4000; // 1st call to Spring may be slow (cold start)
  const CALF_BASELINE_CM = 35.0;  // same value used by Java in the presets

  const GRAVITY_PROFILES = ['0G_ORBIT', '1_6G_MOON', '3_8G_MARS', '1G_EARTH'];
  const MISSION_DAY = 42;

  // 7-day series (copy of astronaut_history.json) so the chart works offline.
  const LOCAL_HISTORY = [
    { mission_day: 36, map_mmhg: 95.0, abi_index: 0.96, heart_rate_bpm: 70 },
    { mission_day: 37, map_mmhg: 94.0, abi_index: 0.94, heart_rate_bpm: 72 },
    { mission_day: 38, map_mmhg: 92.0, abi_index: 0.92, heart_rate_bpm: 74 },
    { mission_day: 39, map_mmhg: 91.0, abi_index: 0.89, heart_rate_bpm: 75 },
    { mission_day: 40, map_mmhg: 90.0, abi_index: 0.87, heart_rate_bpm: 76 },
    { mission_day: 41, map_mmhg: 89.0, abi_index: 0.85, heart_rate_bpm: 78 },
    { mission_day: 42, map_mmhg: 88.0, abi_index: 0.82, heart_rate_bpm: 80 }
  ];

  // ------------------------------------------------------------ adapters
  const ULTRASOUND_TO_BACKEND = {
    jugular_normal: 'NORMAL',
    jugular_dilated: 'DILATED',
    femoral_reduced: 'REDUCED',
    NONE: 'NORMAL',
    NORMAL: 'NORMAL',
    DILATED: 'DILATED',
    REDUCED: 'REDUCED'
  };

  function toBackendPreset(value) {
    return ULTRASOUND_TO_BACKEND[value] || 'NORMAL';
  }

  /** Converts the frontend payload to Java's ReadingRequest record. */
  function toBackendPayload(p) {
    return {
      astronautId: p.astronautId,
      gravityProfile: p.gravityProfile,
      armSystolicMmhg: p.armSystolicMmhg,
      armDiastolicMmhg: p.armDiastolicMmhg,
      ankleSystolicMmhg: p.ankleSystolicMmhg,
      heartRateBpm: Math.round(p.heartRateBpm),
      calfCircumferenceCm: Math.max(0, CALF_BASELINE_CM + Number(p.calfCircumferenceCm || 0)),
      ppgCapillaryRefillSec: Math.max(0, Number(p.ppgCapillaryRefillSec)),
      ultrasoundPreset: toBackendPreset(p.ultrasoundPreset)
    };
  }

  /** Same requirements as Java (validate). An error here becomes a toast in app.js, without falling back to offline. */
  function validatePayload(p) {
    const fail = (msg) => { throw new Error(msg); };
    if (!p || typeof p !== 'object') fail('Reading missing.');
    if (!p.astronautId) fail('Crew member not identified.');
    if (!GRAVITY_PROFILES.includes(p.gravityProfile)) fail('Invalid gravitational environment.');
    ['armSystolicMmhg', 'armDiastolicMmhg', 'ankleSystolicMmhg'].forEach((k) => {
      if (!Number.isFinite(p[k]) || p[k] <= 0) fail('Pressures must be positive numbers.');
    });
    if (p.armSystolicMmhg <= p.armDiastolicMmhg) fail('Arm SBP must be greater than DBP.');
    if (!Number.isFinite(p.heartRateBpm) || p.heartRateBpm <= 0) fail('Enter a valid HR.');
    if (!Number.isFinite(p.calfCircumferenceCm)) fail('Enter the calf variation.');
    if (!Number.isFinite(p.ppgCapillaryRefillSec) || p.ppgCapillaryRefillSec < 0) {
      fail('Invalid capillary refill.');
    }
  }

  // ------------------------------------------------------------- LocalEngine
  // Exact mirror of HemodynamicService.java (provisional rules included).
  const LocalEngine = (function () {
    const ORTHOSTATIC_HR_MIN_BPM = 95;
    const ORTHOSTATIC_PP_MAX_MMHG = 30;

    // Thresholds mirrored from HemodynamicService.java / clinical_rules.json
    const ABI_BLUE_MAX = 0.9;          // ABI <= 0.90: abnormal
    const ABI_GREEN_MAX = 1.4;         // ABI > 1.40: non-compressible (decision: 1.40)
    const PP_RED_BELOW_MMHG = 25;
    const PP_RED_BELOW_FRACTION = 0.25;
    const CAPILLARY_REFILL_MAX_SEC = 2.0; // PROVISIONAL

    const round2 = (v) => Math.round(v * 100) / 100;
    const z = (status, label, action) => ({ status, label, action });

    const calculateMAP = (sys, dia) => (sys + 2 * dia) / 3;
    const calculateABI = (ankle, arm) => ankle / arm;
    const calculatePP = (sys, dia) => sys - dia;

    const classifyMAP = (m) => (m < 70 ? 'BLUE' : m <= 100 ? 'GREEN' : 'YELLOW');
    const classifyABI = (a) => (a <= ABI_BLUE_MAX ? 'BLUE' : a <= ABI_GREEN_MAX ? 'GREEN' : 'YELLOW');
    const classifyPP = (pp, sys) => ((pp < PP_RED_BELOW_MMHG || (sys > 0 && pp / sys < PP_RED_BELOW_FRACTION)) ? 'RED' : pp <= 60 ? 'GREEN' : 'YELLOW');

    // Jugular ultrasound = main marker; low ABI alone only downgrades green -> yellow.
    function headNeck(abi, us) {
      const jugularDilated = us === 'DILATED';
      const lowAbi = classifyABI(abi) === 'BLUE';
      if (jugularDilated && lowAbi) {
        return z('RED', 'Severe Cephalic Congestion (SANS risk)',
          'Apply thigh constriction cuffs (Braslet), elevate the torso at rest and perform an eye exam.');
      }
      if (jugularDilated) return z('YELLOW', 'Mild Cephalic Congestion', 'Start 20 min LBNP and monitor vision.');
      if (lowAbi) {
        return z('YELLOW', 'Reduced Distal Perfusion (watch for cephalic congestion)',
          'Confirm with jugular ultrasound and monitor vision.');
      }
      return z('GREEN', 'No Cephalic Congestion', 'No intervention required.');
    }

    function orthostaticRisk(pp, p) {
      const transition = p.gravityProfile === '3_8G_MARS' || p.gravityProfile === '1G_EARTH';
      return transition && p.heartRateBpm >= ORTHOSTATIC_HR_MIN_BPM && pp < ORTHOSTATIC_PP_MAX_MMHG;
    }

    function thorax(map, pp, p) {
      const ppClass = classifyPP(pp, p.armSystolicMmhg);
      if (ppClass === 'RED') {
        return z('RED', 'Critical Pulse Pressure (hypovolemia)',
          'Urgent fluid replacement protocol and suspension of extravehicular activity (EVA).');
      }
      // DEMO HEURISTIC (not a validated clinical rule)
      if (orthostaticRisk(pp, p)) {
        return z('YELLOW', 'Orthostatic Intolerance Risk (demo alert)',
          'Start pre-hydration and block immediate exit from the module.');
      }
      const m = classifyMAP(map);
      if (m === 'BLUE') return z('BLUE', 'Low MAP', 'Isotonic hydration.');
      if (m === 'YELLOW') return z('YELLOW', 'High MAP', 'Rest and sodium reduction.');
      return ppClass === 'YELLOW'
        ? z('YELLOW', 'High Pulse Pressure', 'Monitor condition.')
        : z('GREEN', 'Stable Cardiac Output', 'Maintain standard aerobic routine.');
    }

    // Capillary refill can only downgrade green -> yellow; never produces red.
    function upperLimbs(map, refillSec) {
      const m = classifyMAP(map);
      if (m === 'BLUE') return z('BLUE', 'Low Systemic Pressure', 'Isotonic hydration.');
      if (m === 'YELLOW') return z('YELLOW', 'High Systemic Pressure', 'Rest and sodium reduction.');
      if (refillSec > CAPILLARY_REFILL_MAX_SEC) {
        return z('YELLOW', 'Reduced Peripheral Perfusion (slow capillary refill)',
          'Repeat the measurement after rest and reassess.');
      }
      return z('GREEN', 'Normal Systemic Perfusion', 'No intervention required.');
    }

    function lowerLimbs(abi) {
      const a = classifyABI(abi);
      if (a === 'BLUE') return z('BLUE', 'Distal Volume Deficit', 'Run pre-hydration protocol.');
      if (a === 'YELLOW') {
        return z('YELLOW', 'High ABI',
          'Activate negative-pressure trousers (LBNP) and lower-limb resistance exercise.');
      }
      return z('GREEN', 'Normal Distal Perfusion', 'No intervention required.');
    }

    /** payload in the frontend format; ultrasoundPreset is normalized here. */
    function evaluate(payload) {
      const p = Object.assign({}, payload, { ultrasoundPreset: toBackendPreset(payload.ultrasoundPreset) });
      const map = calculateMAP(p.armSystolicMmhg, p.armDiastolicMmhg);
      const abi = calculateABI(p.ankleSystolicMmhg, p.armSystolicMmhg);
      const pp = calculatePP(p.armSystolicMmhg, p.armDiastolicMmhg);
      const abiR = round2(abi); // classify with the value shown on screen

      return {
        astronaut_id: p.astronautId,
        mission_day: MISSION_DAY,
        gravity_profile: p.gravityProfile,
        computed_metrics: {
          map_mmhg: round2(map),
          abi_index: round2(abi),
          pulse_pressure_mmhg: round2(pp)
        },
        zones: {
          head_neck: headNeck(abiR, p.ultrasoundPreset),
          thorax_heart: thorax(map, pp, p),
          upper_limbs: upperLimbs(map, p.ppgCapillaryRefillSec),
          lower_limbs: lowerLimbs(abiR)
        },
        history: LOCAL_HISTORY.map((h) => Object.assign({}, h))
      };
    }

    return { evaluate };
  })();

  // Presets A/B/C in the frontend format (same as app.js and spec §5).
  const LOCAL_PRESETS = {
    A: { gravityProfile: '0G_ORBIT',  armSystolicMmhg: 118, armDiastolicMmhg: 76, ankleSystolicMmhg: 112, heartRateBpm: 68, calfCircumferenceCm: 0.0,  ppgCapillaryRefillSec: 1.5, ultrasoundPreset: 'jugular_normal' },
    B: { gravityProfile: '0G_ORBIT',  armSystolicMmhg: 138, armDiastolicMmhg: 88, ankleSystolicMmhg: 108, heartRateBpm: 84, calfCircumferenceCm: 0.0,  ppgCapillaryRefillSec: 1.5, ultrasoundPreset: 'jugular_dilated' },
    C: { gravityProfile: '3_8G_MARS', armSystolicMmhg: 96,  armDiastolicMmhg: 68, ankleSystolicMmhg: 84,  heartRateBpm: 98, calfCircumferenceCm: -2.4, ppgCapillaryRefillSec: 1.5, ultrasoundPreset: 'NONE' }
  };

  function computeLocal(payload, reason) {
    validatePayload(payload);
    const res = LocalEngine.evaluate(payload);
    res._offline = true;
    if (reason) res._offlineReason = reason;
    return res;
  }

  // ------------------------------------------------------------------- network
  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function request(path, options, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT_MS);
    try {
      const res = await fetch(BASE_URL + path, Object.assign({}, options, {
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal
      }));
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { const body = await res.json(); if (body && body.message) msg = body.message; } catch (_) { /* no body */ }
        throw new HttpError(res.status, msg);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function describeFailure(err) {
    if (err && err.name === 'AbortError') return 'timeout (' + TIMEOUT_MS + ' ms)';
    return err && err.message ? err.message : String(err);
  }

  // -------------------------------------------------------------- Public API
  async function postReading(payload) {
    validatePayload(payload); // typing error -> toast in app.js, does not become "offline"
    try {
      return await request('/readings', {
        method: 'POST',
        body: JSON.stringify(toBackendPayload(payload))
      });
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        console.error('[api] Java rejected the reading (' + err.status + '): ' + err.message + ' — using local calculation.');
      } else {
        console.warn('[api] Java unavailable, using local calculation:', describeFailure(err));
      }
      return computeLocal(payload, describeFailure(err));
    }
  }

  async function loadPreset(code) {
    const key = String(code || '').toUpperCase();
    const local = LOCAL_PRESETS[key];
    if (!local) throw new Error('Unknown scenario: ' + code);
    try {
      return await request('/demo/preset/' + encodeURIComponent(key), { method: 'POST' });
    } catch (err) {
      console.warn('[api] preset via Java failed, using local calculation:', describeFailure(err));
      return computeLocal(Object.assign({ astronautId: 'AST-04' }, local), describeFailure(err));
    }
  }

  async function getState(astronautId) {
    const id = astronautId || (window.HemoState && window.HemoState.astronautId) || 'AST-04';
    try {
      return await request('/astronauts/' + encodeURIComponent(id) + '/state', { method: 'GET' });
    } catch (err) {
      console.warn('[api] state via Java failed, using Scenario A values:', describeFailure(err));
      return computeLocal(Object.assign({ astronautId: id }, LOCAL_PRESETS.A), describeFailure(err));
    }
  }

  function classifyUltrasoundLocal(region, preset) {
    const key = region + ':' + preset;
    const table = {
      'JUGULAR:NORMAL':  { region: 'head_neck',   status: 'GREEN',  label: 'Normal jugular',              action: 'Maintain monitoring' },
      'JUGULAR:DILATED': { region: 'head_neck',   status: 'YELLOW', label: 'Jugular change detected', action: 'Reassess cephalic congestion' },
      'FEMORAL:NORMAL':  { region: 'lower_limbs', status: 'GREEN',  label: 'Normal femoral flow',        action: 'Maintain monitoring' },
      'FEMORAL:REDUCED': { region: 'lower_limbs', status: 'BLUE',   label: 'Reduced femoral flow',      action: 'Reassess distal perfusion' }
    };
    const hit = table[key];
    if (!hit) throw new Error('Invalid region/preset combination: ' + key);
    return Object.assign({ classification: preset }, hit);
  }

  /** Accepts Tab 3 presets ('jugular_dilated') or Java presets ('DILATED'); infers the region if missing. */
  async function classifyUltrasound(req) {
    const preset = toBackendPreset(req && req.ultrasoundPreset);
    const raw = String((req && req.ultrasoundPreset) || '').toLowerCase();
    const region = String((req && req.region) || (raw.startsWith('femoral') ? 'FEMORAL' : 'JUGULAR')).toUpperCase();
    const astronautId = (req && req.astronautId) || (window.HemoState && window.HemoState.astronautId) || 'AST-04';
    try {
      return await request('/ultrasound/classify', {
        method: 'POST',
        body: JSON.stringify({ astronautId, region, ultrasoundPreset: preset })
      });
    } catch (err) {
      console.warn('[api] classification via Java failed, using local rule:', describeFailure(err));
      return Object.assign(classifyUltrasoundLocal(region, preset), { _offline: true });
    }
  }

  /** "Warms up" Spring (cold start) so the demo's 1st reading does not exceed 500 ms. */
  function warmup() {
    return request('/astronauts/AST-04/state', { method: 'GET' }, WARMUP_TIMEOUT_MS)
      .then(() => true)
      .catch(() => false);
  }

  /** Console: ApiClient.selfTest() — checks A/B/C in the local engine against the spec and HemodynamicServiceTest. */
  function selfTest() {
    const expected = {
      A: { map: 90.0,   abi: 0.95, head: 'GREEN', thorax: 'GREEN',  upper: 'GREEN',  lower: 'GREEN' },
      B: { map: 104.67, abi: 0.78, head: 'RED',   thorax: 'YELLOW', upper: 'YELLOW', lower: 'BLUE' },
      C: { map: 77.33,  abi: 0.88, head: 'YELLOW', thorax: 'YELLOW', upper: 'GREEN',  lower: 'BLUE' }
    };
    const rows = Object.keys(expected).map((code) => {
      const r = computeLocal(Object.assign({ astronautId: 'AST-04' }, LOCAL_PRESETS[code]));
      const e = expected[code];
      const got = {
        map: r.computed_metrics.map_mmhg, abi: r.computed_metrics.abi_index,
        head: r.zones.head_neck.status, thorax: r.zones.thorax_heart.status,
        upper: r.zones.upper_limbs.status, lower: r.zones.lower_limbs.status
      };
      const ok = Math.abs(got.map - e.map) < 0.01 && Math.abs(got.abi - e.abi) < 0.01 &&
        got.head === e.head && got.thorax === e.thorax && got.upper === e.upper && got.lower === e.lower;
      return { scenario: code, ok, expected: JSON.stringify(e), got: JSON.stringify(got) };
    });
    if (typeof console.table === 'function') console.table(rows);
    const allOk = rows.every((r) => r.ok);
    console[allOk ? 'log' : 'error']('[api] selfTest ' + (allOk ? 'OK' : 'FAILED'));
    return allOk;
  }

  window.ApiClient = {
    BASE_URL, postReading, loadPreset, getState, classifyUltrasound,
    computeLocal, toBackendPayload, warmup, selfTest
  };

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', () => { warmup(); });
  }
})();
