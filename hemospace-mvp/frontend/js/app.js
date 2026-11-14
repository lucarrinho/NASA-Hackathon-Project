/* ==========================================================================
   HemoSpace v1.0 — app.js  [Dev 1 · Orquestrador]

   Responsabilidades:
   - Estado global (window.HemoState)
   - Troca de ambiente gravitacional (0g / 1/6g / 3/8g / 1g)
   - Botões de Cenário Demo A / B / C
   - Troca de abas do módulo inferior
   - Fluxo: coleta -> ApiClient.postReading(payload) (Dev 5)
            -> BodyMap.render(zones, gravity)       (Dev 3)
            -> ClinicalPanel.render(zone, data)     (Dev 4)

   Contrato com os outros módulos: ver README.md na raiz do projeto.
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------ constantes
  const ZONE_KEYS = ['head_neck', 'thorax_heart', 'upper_limbs', 'lower_limbs'];

  // ids dos grupos do SVG anatômico (Dev 3) para cada zona
  const SVG_ZONE_IDS = {
    head_neck: 'zone-head',
    thorax_heart: 'zone-thorax',
    upper_limbs: 'zone-arms',
    lower_limbs: 'zone-legs'
  };

  // status do contrato JSON -> classe CSS
  const STATUS_CLASS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };
  const ALL_STATUS_CLASSES = Object.values(STATUS_CLASS);

  const GRAVITIES = ['0G_ORBIT', '1_6G_MOON', '3_8G_MARS', '1G_EARTH'];

  // Se true e ApiClient.loadPreset existir, os botões A/B/C chamam
  // POST /api/v1/demo/preset/{code}. Por padrão os valores da spec §5 são
  // preenchidos no formulário e enviados via postReading (funciona offline).
  const USE_BACKEND_PRESETS = false;

  // Cenários validados (spec §5). ultrasoundPreset usa os mesmos ids de data-sample da Aba 3.
  const PRESETS = {
    A: { gravityProfile: '0G_ORBIT',  armSys: 118, armDia: 76, ankleSys: 112, hr: 68, calf: 0.0,  ultrasoundPreset: 'jugular_normal'  },
    B: { gravityProfile: '0G_ORBIT',  armSys: 138, armDia: 88, ankleSys: 108, hr: 84, calf: 0.0,  ultrasoundPreset: 'jugular_dilated' },
    C: { gravityProfile: '3_8G_MARS', armSys: 96,  armDia: 68, ankleSys: 84,  hr: 98, calf: -2.4, ultrasoundPreset: 'NONE'            }
  };

  // ------------------------------------------------------------------ estado global
  const S = (window.HemoState = {
    astronautId: 'AST-04',
    missionDay: 42,
    gravityProfile: '0G_ORBIT',
    selectedZone: 'head_neck',
    data: null,                 // último AstronautStateResponse
    lastPayload: null,          // último ReadingRequest enviado
    activePreset: null,         // 'A' | 'B' | 'C' | null
    offline: false,
    busy: false,
    // Preenchidos pelos módulos de captura (Dev 5 / Dev 6):
    ppgCapillaryRefillSec: 1.5, // inputs.js atualiza após a leitura óptica
    ultrasoundPreset: 'NONE'    // ultrasound.js: 'jugular_normal' | 'jugular_dilated' | 'femoral_reduced' | 'NONE'
  });

  const $ = (id) => document.getElementById(id);
  let requestSeq = 0;
  const warned = {};

  // ------------------------------------------------------------------ utilidades
  /** Chama window[moduleName][method] sem derrubar o app se o módulo ainda não existir ou falhar. */
  function callModule(moduleName, method, ...args) {
    const mod = window[moduleName];
    if (!mod || typeof mod[method] !== 'function') {
      const key = moduleName + '.' + method;
      if (!warned[key]) {
        warned[key] = true;
        console.warn('[HemoSpace] ' + key + ' ainda não disponível (merge pendente).');
      }
      return;
    }
    try {
      mod[method](...args);
    } catch (err) {
      console.error('[HemoSpace] erro em ' + moduleName + '.' + method, err);
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
      switchTab('tab-manual'); // o formulário precisa estar visível para mostrar o erro
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
      showToast('Preencha todos os campos numéricos da Aba 1.');
      return null;
    }
    return payload;
  }

  // ------------------------------------------------------------------ diagnóstico
  function setBusy(busy) {
    S.busy = busy;
    const btn = $('btn-update-diagnosis');
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.disabled = busy;
    btn.textContent = busy ? 'Atualizando…' : btn.dataset.label;
  }

  /**
   * Executa uma requisição de diagnóstico e distribui o resultado.
   * Respostas obsoletas (cliques rápidos) são descartadas.
   */
  async function requestDiagnosis(fetcher, payload) {
    const seq = ++requestSeq;
    setBusy(true);
    try {
      const data = await fetcher();
      if (seq !== requestSeq) return;
      if (!data || !data.zones) throw new Error('Resposta sem o objeto "zones".');
      if (payload) S.lastPayload = payload;
      applyResponse(data);
    } catch (err) {
      if (seq !== requestSeq) return;
      console.error('[HemoSpace] falha ao atualizar diagnóstico', err);
      showToast('Falha ao atualizar o diagnóstico: ' + (err && err.message ? err.message : err));
    } finally {
      if (seq === requestSeq) setBusy(false);
    }
  }

  function runDiagnosis() {
    const payload = buildPayload();
    if (!payload) return Promise.resolve();
    if (!window.ApiClient || typeof window.ApiClient.postReading !== 'function') {
      showToast('ApiClient.postReading não encontrado (js/api.js).');
      return Promise.resolve();
    }
    return requestDiagnosis(() => window.ApiClient.postReading(payload), payload);
  }

  // ------------------------------------------------------------------ renderização
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
    if (info) info.textContent = 'Tripulante: ' + S.astronautId + ' (Dia ' + S.missionDay + ')';
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
      const on = key === S.selectedZone;
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
    el.textContent = S.offline ? 'Modo offline (cálculo local)' : 'API Java online';
  }

  // ------------------------------------------------------------------ zona selecionada
  /** Chamada pelo bodymap.js (clique no SVG) e pelos cards do index.html. */
  function selectZone(zoneKey) {
    if (!ZONE_KEYS.includes(zoneKey)) {
      console.warn('[HemoSpace] zona desconhecida:', zoneKey);
      return;
    }
    S.selectedZone = zoneKey;
    highlightSelected();
    if (S.data) callModule('ClinicalPanel', 'render', zoneKey, S.data);
    emit('hemospace:zone', { zoneKey });
  }

  // ------------------------------------------------------------------ gravidade
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

  // ------------------------------------------------------------------ cenários demo
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
    switchTab('tab-manual'); // apresentador vê os números injetados

    const payload = buildPayload();
    if (!payload) return Promise.resolve();

    if (USE_BACKEND_PRESETS && window.ApiClient && typeof window.ApiClient.loadPreset === 'function') {
      return requestDiagnosis(() => window.ApiClient.loadPreset(code), payload);
    }
    if (!window.ApiClient || typeof window.ApiClient.postReading !== 'function') {
      showToast('ApiClient.postReading não encontrado (js/api.js).');
      return Promise.resolve();
    }
    return requestDiagnosis(() => window.ApiClient.postReading(payload), payload);
  }

  // ------------------------------------------------------------------ abas
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
    emit('hemospace:tab', { tab: tabId }); // inputs.js pode ligar/desligar a webcam aqui
  }

  // ------------------------------------------------------------------ inicialização
  function decorateCards() {
    // acessibilidade por teclado nos cards (sem mexer no HTML compartilhado)
    ZONE_KEYS.forEach((key) => {
      const card = $('card-' + key);
      if (!card) return;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          selectZone(key);
        }
      });
    });
  }

  function bindEvents() {
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
        ev.preventDefault(); // Enter no formulário não recarrega a página
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
    runDiagnosis(); // estado inicial: valores padrão do formulário (= Cenário A)
  }

  // API pública (globais exigidos pela spec + atalhos para depuração)
  window.selectZone = selectZone;
  window.HemoApp = { runDiagnosis, applyPreset, setGravity, selectZone, switchTab, showToast, PRESETS };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
