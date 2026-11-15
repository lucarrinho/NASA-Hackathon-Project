/* ==========================================================================
   HemoSpace v1.0 — api.js  [Dev 5 · Camada de API + fallback offline]

   Contrato público (README):
     ApiClient.postReading(payload)  -> Promise<AstronautStateResponse>
     ApiClient.loadPreset(code)      -> Promise<AstronautStateResponse>   (A | B | C)
     ApiClient.getState(id)          -> Promise<AstronautStateResponse>
     ApiClient.classifyUltrasound({astronautId, region, ultrasoundPreset})
     ApiClient.computeLocal(payload) -> AstronautStateResponse (sempre com _offline: true)
     ApiClient.selfTest()            -> confere Cenários A/B/C no motor local (console)

   Regra 2: se o Java não responder em 500 ms (ou cair), calcula localmente.
   O LocalEngine abaixo replica HemodynamicService.java regra por regra.
   >>> Se o Dev 2 mudar qualquer limiar/texto no Java, atualize LocalEngine junto. <<<

   Adaptações entre o frontend e o record ReadingRequest (feitas só aqui):
   - ultrasoundPreset: 'jugular_normal' | 'jugular_dilated' | 'femoral_reduced' | 'NONE'
       -> 'NORMAL' | 'DILATED' | 'REDUCED' (o Java rejeita os ids da Aba 3).
   - calfCircumferenceCm: o formulário envia a VARIAÇÃO (ex.: -2.4); o Java exige valor
       não negativo, então enviamos CALF_BASELINE_CM + variação.
   ========================================================================== */
(function () {
  'use strict';

  const BASE_URL = 'http://localhost:8080/api/v1';
  const TIMEOUT_MS = 500;         // Regra 2
  const WARMUP_TIMEOUT_MS = 4000; // 1ª chamada ao Spring pode demorar (cold start)
  const CALF_BASELINE_CM = 35.0;  // mesmo valor usado pelo Java nos presets

  const GRAVITY_PROFILES = ['0G_ORBIT', '1_6G_MOON', '3_8G_MARS', '1G_EARTH'];
  const MISSION_DAY = 42;

  // Série de 7 dias (cópia de astronaut_history.json) para o gráfico funcionar offline.
  const LOCAL_HISTORY = [
    { mission_day: 36, map_mmhg: 95.0, abi_index: 0.96, heart_rate_bpm: 70 },
    { mission_day: 37, map_mmhg: 94.0, abi_index: 0.94, heart_rate_bpm: 72 },
    { mission_day: 38, map_mmhg: 92.0, abi_index: 0.92, heart_rate_bpm: 74 },
    { mission_day: 39, map_mmhg: 91.0, abi_index: 0.89, heart_rate_bpm: 75 },
    { mission_day: 40, map_mmhg: 90.0, abi_index: 0.87, heart_rate_bpm: 76 },
    { mission_day: 41, map_mmhg: 89.0, abi_index: 0.85, heart_rate_bpm: 78 },
    { mission_day: 42, map_mmhg: 88.0, abi_index: 0.82, heart_rate_bpm: 80 }
  ];

  // ------------------------------------------------------------ adaptadores
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

  /** Converte o payload do frontend para o record ReadingRequest do Java. */
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

  /** Mesmas exigências do Java (validate). Erro aqui vira toast no app.js, sem cair no offline. */
  function validatePayload(p) {
    const fail = (msg) => { throw new Error(msg); };
    if (!p || typeof p !== 'object') fail('Leitura ausente.');
    if (!p.astronautId) fail('Tripulante não identificado.');
    if (!GRAVITY_PROFILES.includes(p.gravityProfile)) fail('Ambiente gravitacional inválido.');
    ['armSystolicMmhg', 'armDiastolicMmhg', 'ankleSystolicMmhg'].forEach((k) => {
      if (!Number.isFinite(p[k]) || p[k] <= 0) fail('As pressões devem ser números positivos.');
    });
    if (p.armSystolicMmhg <= p.armDiastolicMmhg) fail('A PAS do braço precisa ser maior que a PAD.');
    if (!Number.isFinite(p.heartRateBpm) || p.heartRateBpm <= 0) fail('Informe uma FC válida.');
    if (!Number.isFinite(p.calfCircumferenceCm)) fail('Informe a variação da panturrilha.');
    if (!Number.isFinite(p.ppgCapillaryRefillSec) || p.ppgCapillaryRefillSec < 0) {
      fail('Retorno capilar inválido.');
    }
  }

  // ------------------------------------------------------------- LocalEngine
  // Espelho exato de HemodynamicService.java (regras provisórias incluídas).
  const LocalEngine = (function () {
    const ORTHOSTATIC_HR_MIN_BPM = 95;
    const ORTHOSTATIC_PP_MAX_MMHG = 30;

    // Limiares espelhados de HemodynamicService.java / clinical_rules.json
    const ABI_BLUE_MAX = 0.9;          // ITB <= 0,90: anormal
    const ABI_GREEN_MAX = 1.4;         // ITB > 1,40: não compressível (decisão: 1,40)
    const PP_RED_BELOW_MMHG = 25;
    const PP_RED_BELOW_FRACTION = 0.25;
    const CAPILLARY_REFILL_MAX_SEC = 2.0; // PROVISÓRIO

    const round2 = (v) => Math.round(v * 100) / 100;
    const z = (status, label, action) => ({ status, label, action });

    const calculateMAP = (sys, dia) => (sys + 2 * dia) / 3;
    const calculateABI = (ankle, arm) => ankle / arm;
    const calculatePP = (sys, dia) => sys - dia;

    const classifyMAP = (m) => (m < 70 ? 'BLUE' : m <= 100 ? 'GREEN' : 'YELLOW');
    const classifyABI = (a) => (a <= ABI_BLUE_MAX ? 'BLUE' : a <= ABI_GREEN_MAX ? 'GREEN' : 'YELLOW');
    const classifyPP = (pp, sys) => ((pp < PP_RED_BELOW_MMHG || (sys > 0 && pp / sys < PP_RED_BELOW_FRACTION)) ? 'RED' : pp <= 60 ? 'GREEN' : 'YELLOW');

    // Ultrassom jugular = marcador principal; ITB baixo sozinho só rebaixa verde -> amarelo.
    function headNeck(abi, us) {
      const jugularDilated = us === 'DILATED';
      const lowAbi = classifyABI(abi) === 'BLUE';
      if (jugularDilated && lowAbi) {
        return z('RED', 'Congestão Cefálica Severa (risco SANS)',
          'Aplicar cintas de contenção nas coxas (Braslet), elevar tronco no repouso e realizar exame ocular.');
      }
      if (jugularDilated) return z('YELLOW', 'Congestão Cefálica Leve', 'Iniciar LBNP 20 min e monitorar visão.');
      if (lowAbi) {
        return z('YELLOW', 'Perfusão Distal Reduzida (vigiar congestão cefálica)',
          'Confirmar com ultrassom jugular e monitorar visão.');
      }
      return z('GREEN', 'Sem Congestão Cefálica', 'Nenhuma intervenção necessária.');
    }

    function orthostaticRisk(pp, p) {
      const transition = p.gravityProfile === '3_8G_MARS' || p.gravityProfile === '1G_EARTH';
      return transition && p.heartRateBpm >= ORTHOSTATIC_HR_MIN_BPM && pp < ORTHOSTATIC_PP_MAX_MMHG;
    }

    function thorax(map, pp, p) {
      const ppClass = classifyPP(pp, p.armSystolicMmhg);
      if (ppClass === 'RED') {
        return z('RED', 'Pressão de Pulso Crítica (hipovolemia)',
          'Protocolo urgente de reposição volêmica e suspensão de atividade extraveicular (EVA).');
      }
      // HEURÍSTICA DE DEMONSTRAÇÃO (não é regra clínica validada)
      if (orthostaticRisk(pp, p)) {
        return z('YELLOW', 'Risco de Intolerância Ortostática (alerta de demonstração)',
          'Iniciar pré-hidratação e bloquear saída imediata do módulo.');
      }
      const m = classifyMAP(map);
      if (m === 'BLUE') return z('BLUE', 'PAM Baixa', 'Hidratação isotônica.');
      if (m === 'YELLOW') return z('YELLOW', 'PAM Elevada', 'Repouso e redução de sódio.');
      return ppClass === 'YELLOW'
        ? z('YELLOW', 'Pressão de Pulso Elevada', 'Monitorar condição.')
        : z('GREEN', 'Débito Cardíaco Estável', 'Manter rotina aeróbica padrão.');
    }

    // Retorno capilar só pode rebaixar verde -> amarelo; nunca gera vermelho.
    function upperLimbs(map, refillSec) {
      const m = classifyMAP(map);
      if (m === 'BLUE') return z('BLUE', 'Pressão Sistêmica Baixa', 'Hidratação isotônica.');
      if (m === 'YELLOW') return z('YELLOW', 'Pressão Sistêmica Elevada', 'Repouso e redução de sódio.');
      if (refillSec > CAPILLARY_REFILL_MAX_SEC) {
        return z('YELLOW', 'Perfusão Periférica Reduzida (retorno capilar lento)',
          'Repetir a medição após repouso e reavaliar.');
      }
      return z('GREEN', 'Perfusão Sistêmica Normal', 'Nenhuma intervenção necessária.');
    }

    function lowerLimbs(abi) {
      const a = classifyABI(abi);
      if (a === 'BLUE') return z('BLUE', 'Déficit de Volume Distal', 'Executar protocolo de pré-hidratação.');
      if (a === 'YELLOW') {
        return z('YELLOW', 'ITB Elevado',
          'Ativar calça de pressão negativa (LBNP) e exercício resistido de membros inferiores.');
      }
      return z('GREEN', 'Perfusão Distal Normal', 'Nenhuma intervenção necessária.');
    }

    /** payload no formato do frontend; ultrasoundPreset é normalizado aqui. */
    function evaluate(payload) {
      const p = Object.assign({}, payload, { ultrasoundPreset: toBackendPreset(payload.ultrasoundPreset) });
      const map = calculateMAP(p.armSystolicMmhg, p.armDiastolicMmhg);
      const abi = calculateABI(p.ankleSystolicMmhg, p.armSystolicMmhg);
      const pp = calculatePP(p.armSystolicMmhg, p.armDiastolicMmhg);
      const abiR = round2(abi); // classifica com o valor mostrado na tela

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

  // Presets A/B/C no formato do frontend (iguais aos do app.js e da spec §5).
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

  // ------------------------------------------------------------------- rede
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
        try { const body = await res.json(); if (body && body.message) msg = body.message; } catch (_) { /* sem corpo */ }
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

  // -------------------------------------------------------------- API pública
  async function postReading(payload) {
    validatePayload(payload); // erro de digitação -> toast no app.js, não vira "offline"
    try {
      return await request('/readings', {
        method: 'POST',
        body: JSON.stringify(toBackendPayload(payload))
      });
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        console.error('[api] o Java recusou a leitura (' + err.status + '): ' + err.message + ' — usando cálculo local.');
      } else {
        console.warn('[api] Java indisponível, usando cálculo local:', describeFailure(err));
      }
      return computeLocal(payload, describeFailure(err));
    }
  }

  async function loadPreset(code) {
    const key = String(code || '').toUpperCase();
    const local = LOCAL_PRESETS[key];
    if (!local) throw new Error('Cenário desconhecido: ' + code);
    try {
      return await request('/demo/preset/' + encodeURIComponent(key), { method: 'POST' });
    } catch (err) {
      console.warn('[api] preset via Java falhou, usando cálculo local:', describeFailure(err));
      return computeLocal(Object.assign({ astronautId: 'AST-04' }, local), describeFailure(err));
    }
  }

  async function getState(astronautId) {
    const id = astronautId || (window.HemoState && window.HemoState.astronautId) || 'AST-04';
    try {
      return await request('/astronauts/' + encodeURIComponent(id) + '/state', { method: 'GET' });
    } catch (err) {
      console.warn('[api] estado via Java falhou, usando valores do Cenário A:', describeFailure(err));
      return computeLocal(Object.assign({ astronautId: id }, LOCAL_PRESETS.A), describeFailure(err));
    }
  }

  function classifyUltrasoundLocal(region, preset) {
    const key = region + ':' + preset;
    const table = {
      'JUGULAR:NORMAL':  { region: 'head_neck',   status: 'GREEN',  label: 'Jugular normal',              action: 'Manter monitoramento' },
      'JUGULAR:DILATED': { region: 'head_neck',   status: 'YELLOW', label: 'Alteração jugular detectada', action: 'Reavaliar congestão cefálica' },
      'FEMORAL:NORMAL':  { region: 'lower_limbs', status: 'GREEN',  label: 'Fluxo femoral normal',        action: 'Manter monitoramento' },
      'FEMORAL:REDUCED': { region: 'lower_limbs', status: 'BLUE',   label: 'Fluxo femoral reduzido',      action: 'Reavaliar perfusão distal' }
    };
    const hit = table[key];
    if (!hit) throw new Error('Combinação inválida de região/preset: ' + key);
    return Object.assign({ classification: preset }, hit);
  }

  /** Aceita presets da Aba 3 ('jugular_dilated') ou do Java ('DILATED'); deduz a região se faltar. */
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
      console.warn('[api] classificação via Java falhou, usando regra local:', describeFailure(err));
      return Object.assign(classifyUltrasoundLocal(region, preset), { _offline: true });
    }
  }

  /** "Aquece" o Spring (cold start) para a 1ª leitura da demo não estourar os 500 ms. */
  function warmup() {
    return request('/astronauts/AST-04/state', { method: 'GET' }, WARMUP_TIMEOUT_MS)
      .then(() => true)
      .catch(() => false);
  }

  /** Console: ApiClient.selfTest() — confere A/B/C no motor local contra a spec e o HemodynamicServiceTest. */
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
      return { cenario: code, ok, esperado: JSON.stringify(e), obtido: JSON.stringify(got) };
    });
    if (typeof console.table === 'function') console.table(rows);
    const allOk = rows.every((r) => r.ok);
    console[allOk ? 'log' : 'error']('[api] selfTest ' + (allOk ? 'OK' : 'FALHOU'));
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
