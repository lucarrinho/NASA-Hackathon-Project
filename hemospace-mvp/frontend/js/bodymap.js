/* HemoSpace — DEV3: mapa corporal.
   Só apresenta o estado recebido; não calcula nada clínico.
   Contrato: BodyMap.render(zones, gravityProfile) · clique/Enter/Espaço -> window.selectZone(zoneKey)
   A classe de seleção (.selected) e o realce são aplicados pelo app.js (Dev1). */
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
      console.warn('BodyMap: status ausente/desconhecido em "' + zoneKey + '":', zoneData && zoneData.status);
    }
    if (zoneData && zoneData.label) el.setAttribute('aria-label', zoneData.label);
  }

  // `hidden` não é confiável em elementos SVG: usa-se o atributo display.
  function setShown(el, shown) {
    if (!el) return;
    if (shown) el.removeAttribute('display');
    else el.setAttribute('display', 'none');
  }

  // REGRA VISUAL DE GRAVIDADE (proposta simples; validar com a equipe):
  //  - 0g: fluxo cefálico (seta p/ cima, cheia).
  //  - 1g: fluxo distal (seta p/ baixo, cheia).
  //  - Lua (1/6g) e Marte (3/8g): ainda há gravidade, então a seta aponta p/ baixo como em 1g,
  //    mas tracejada e mais fraca, proporcional à gravidade (Marte > Lua). É só um recurso
  //    visual: não representa medição nem diagnóstico.
  const GRAVITY_VIEW = {
    '0G_ORBIT':  { text: '0 g · fluxo cefálico',          arrow: 'up',   strength: 1,    partial: false },
    '1_6G_MOON': { text: '1/6 g · fluxo distal parcial',  arrow: 'down', strength: 0.45, partial: true },
    '3_8G_MARS': { text: '3/8 g · fluxo distal parcial',  arrow: 'down', strength: 0.7,  partial: true },
    '1G_EARTH':  { text: '1 g · fluxo distal',            arrow: 'down', strength: 1,    partial: false }
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

  // Apenas velocidade visual: duração do ciclo = 60 / bpm (não classifica a FC).
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

  // FC: 3º argumento opcional {heartRateBpm}; senão, o último payload enviado pelo app.js
  // (window.HemoState.lastPayload.heartRateBpm — campo já existente no ReadingRequest).
  function render(zonesData, gravityProfile, options) {
    if (!zonesData || typeof zonesData !== 'object') {
      console.warn('BodyMap: dados de zonas ausentes ou inválidos.');
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
    else console.warn('BodyMap: window.selectZone ainda não está disponível.');
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
    // acessibilidade: reflete a zona selecionada (evento emitido pelo app.js)
    document.addEventListener('hemospace:zone', (ev) => syncPressed(ev.detail && ev.detail.zoneKey));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindZoneEvents);
  else bindZoneEvents();

  window.BodyMap = { render, setHeartRate };
})();
