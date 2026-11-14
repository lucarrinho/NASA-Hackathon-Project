/* ==========================================================================
   HemoSpace v1.0 — inputs.js  [Dev 5 · Captura biométrica]

   Aba 1 (Medição Rápida): usa o formulário do index.html (#manual-reading-form).
     - limites nativos (min/max) + regra PAD < PAS via setCustomValidity, para o
       form.checkValidity() do app.js já bloquear leituras inválidas;
     - Enter em qualquer campo envia (requestSubmit -> submit tratado pelo app.js).

   Aba 2 (Scanner Óptico): #tab-optical.
     - webcam PPG (getUserMedia): média do canal vermelho -> filtro -> picos -> bpm;
     - onda de pulso em #ppg-canvas; FC detectada preenche #input-hr;
     - cronômetro de retorno capilar -> window.HemoState.ppgCapillaryRefillSec;
     - #btn-simulate-ppg gera um sinal sintético pelo MESMO pipeline (plano B do telão).

   Integração com o app.js (Dev 1), sem editar arquivos alheios:
     - escuta 'hemospace:tab' para desligar a câmera ao sair da Aba 2;
     - após uma leitura concluída chama window.HemoApp.runDiagnosis().
   Simulação educacional: a medição por webcam não tem validade clínica.
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------ config
  const FIELD_LIMITS = {
    'input-arm-sys':   { min: 50,  max: 260 },
    'input-arm-dia':   { min: 30,  max: 160 },
    'input-ankle-sys': { min: 40,  max: 300 },
    'input-hr':        { min: 30,  max: 220 },
    'input-calf':      { min: -10, max: 10 }
  };

  const CAPILLARY_MAX_SEC = 10;
  const SIM_CAPILLARY_SEC = 1.8; // valor plausível devolvido pela simulação

  const PPG = {
    windowMs: 12000,
    minDurationMs: 5000,
    stableDurationMs: 7000,
    detrendMs: 900,
    smoothMs: 120,
    minPeakGapMs: 330,
    intervalMin: 300,
    intervalMax: 1500,
    sampleEveryMs: 33,
    drawEveryMs: 100,
    simDurationMs: 9000
  };

  // ------------------------------------------------------------------ estado
  const st = {
    mode: 'idle',          // 'idle' | 'camera' | 'sim'
    buf: [],               // { t, v }
    stream: null,
    raf: 0,
    simTimer: 0,
    lastSample: 0,
    lastDraw: 0,
    lastBpm: null,
    applied: false,
    cap: { t0: 0, timer: 0, running: false },
    el: {}
  };

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hs = () => window.HemoState || null;

  function setInputValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function readNumber(id) {
    const el = $(id);
    if (!el || el.value.trim() === '') return NaN;
    return Number(el.value);
  }

  function requestDiagnosis() {
    if (window.HemoApp && typeof window.HemoApp.runDiagnosis === 'function') {
      window.HemoApp.runDiagnosis();
    }
  }

  // ------------------------------------------------------------------- CSS
  function injectCss() {
    if ($('inputs-css')) return;
    const style = document.createElement('style');
    style.id = 'inputs-css';
    style.textContent = `
.ppg-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.ppg-btn {
  padding: .45rem .8rem; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 600;
  border: 1px solid var(--border, #475569); background: transparent; color: inherit;
}
.ppg-btn:hover:not(:disabled) { border-color: var(--accent, #2563EB); }
.ppg-btn:disabled { opacity: .5; cursor: not-allowed; }
.ppg-btn:focus-visible { outline: 3px solid var(--accent, #2563EB); outline-offset: 2px; }
#ppg-status { font-weight: 600; min-height: 1.3em; }
#ppg-bpm { font-variant-numeric: tabular-nums; font-weight: 700; }
.ppg-note { font-size: .78rem; color: var(--muted, #94a3b8); }
`;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------- Aba 1: form
  function setupForm() {
    const form = $('manual-reading-form');
    if (!form) return;

    Object.keys(FIELD_LIMITS).forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.min = FIELD_LIMITS[id].min;
      el.max = FIELD_LIMITS[id].max;
      el.inputMode = 'decimal';
    });

    const sys = $('input-arm-sys');
    const dia = $('input-arm-dia');
    function checkPressures() {
      if (!sys || !dia) return;
      const s = readNumber('input-arm-sys');
      const d = readNumber('input-arm-dia');
      const bad = Number.isFinite(s) && Number.isFinite(d) && d >= s;
      dia.setCustomValidity(bad ? 'A PAD precisa ser menor que a PAS.' : '');
    }
    [sys, dia].forEach((el) => el && el.addEventListener('input', checkPressures));
    checkPressures();

    // Formulário sem botão de envio: Enter não envia sozinho, então fazemos isso aqui.
    form.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
      ev.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  // ------------------------------------------------------ Aba 2: montagem DOM
  function button(id, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'ppg-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function setupOptical() {
    const controls = document.querySelector('#tab-optical .optical-controls');
    if (!controls) return;

    st.el.video = $('ppg-video');
    st.el.canvas = $('ppg-canvas');
    st.el.capLabel = $('capillary-timer');
    st.el.sim = $('btn-simulate-ppg');

    if (st.el.video) st.el.video.muted = true;

    const status = document.createElement('div');
    status.id = 'ppg-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Câmera desligada. Use "Simular Leitura Óptica" se não houver câmera.';

    const bpm = document.createElement('div');
    bpm.innerHTML = 'FC óptica: <span id="ppg-bpm">--</span> bpm';

    const camRow = document.createElement('div');
    camRow.className = 'ppg-row';
    st.el.camStart = button('btn-ppg-start', 'Ligar câmera', startCamera);
    st.el.camStop = button('btn-ppg-stop', 'Parar câmera', stopCamera);
    st.el.camStop.disabled = true;
    camRow.append(st.el.camStart, st.el.camStop);

    const capRow = document.createElement('div');
    capRow.className = 'ppg-row';
    st.el.capStart = button('btn-cap-start', 'Soltar compressão', capStart);
    st.el.capStop = button('btn-cap-stop', 'Cor voltou', capStop);
    st.el.capStop.disabled = true;
    capRow.append(st.el.capStart, st.el.capStop);

    const note = document.createElement('div');
    note.className = 'ppg-note';
    note.textContent = 'Cubra a lente com a ponta do dedo. Simulação educacional, sem validade clínica.';

    // Ordem: status, bpm, câmera, capilar, (label e botão de simulação já existentes), nota.
    controls.prepend(status, bpm, camRow, capRow);
    controls.append(note);

    st.el.status = status;
    st.el.bpm = $('ppg-bpm');

    if (st.el.sim) st.el.sim.addEventListener('click', simulate);
    renderCapillary(currentCapillary());
    drawWave(null);
  }

  function setStatus(msg) {
    if (st.el.status) st.el.status.textContent = msg;
  }

  // -------------------------------------------------------- processamento PPG
  // Média móvel centrada em janela de tempo (usa timestamps reais, não assume fps).
  function movingAvg(ts, vs, win) {
    const out = new Array(vs.length);
    let lo = 0;
    let hi = 0;
    let sum = 0;
    const half = win / 2;
    for (let i = 0; i < vs.length; i++) {
      while (hi < vs.length && ts[hi] <= ts[i] + half) { sum += vs[hi]; hi++; }
      while (ts[lo] < ts[i] - half) { sum -= vs[lo]; lo++; }
      out[i] = sum / (hi - lo);
    }
    return out;
  }

  function analyze() {
    const b = st.buf;
    if (b.length < 30) return null;
    const ts = b.map((p) => p.t);
    const raw = b.map((p) => p.v);
    const base = movingAvg(ts, raw, PPG.detrendMs);
    // Mais sangue = menos luz vermelha refletida: inverte o sinal.
    const detr = raw.map((v, i) => base[i] - v);
    const sig = movingAvg(ts, detr, PPG.smoothMs);

    const mean = sig.reduce((a, c) => a + c, 0) / sig.length;
    const sd = Math.sqrt(sig.reduce((a, c) => a + (c - mean) ** 2, 0) / sig.length) || 1e-6;
    const thr = mean + 0.4 * sd;

    const peaks = [];
    for (let i = 1; i < sig.length - 1; i++) {
      if (sig[i] > thr && sig[i] >= sig[i - 1] && sig[i] > sig[i + 1]) {
        const last = peaks[peaks.length - 1];
        if (last !== undefined && ts[i] - ts[last] < PPG.minPeakGapMs) {
          if (sig[i] > sig[last]) peaks[peaks.length - 1] = i; // mantém o maior
        } else {
          peaks.push(i);
        }
      }
    }

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const d = ts[peaks[i]] - ts[peaks[i - 1]];
      if (d >= PPG.intervalMin && d <= PPG.intervalMax) intervals.push(d);
    }

    const dur = ts[ts.length - 1] - ts[0];
    let bpm = null;
    let stable = false;
    if (dur >= PPG.minDurationMs && intervals.length >= 4) {
      const sorted = intervals.slice().sort((a, c) => a - c);
      bpm = Math.round(60000 / sorted[Math.floor(sorted.length / 2)]);
      const m = intervals.reduce((a, c) => a + c, 0) / intervals.length;
      const cv = Math.sqrt(intervals.reduce((a, c) => a + (c - m) ** 2, 0) / intervals.length) / m;
      stable = cv < 0.2 && dur >= PPG.stableDurationMs && bpm >= 30 && bpm <= 220;
    }
    return { ts, sig, sd, bpm, stable };
  }

  function drawWave(a) {
    const cv = st.el.canvas;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    if (!a) return;

    const spanMs = 6000;
    const tEnd = a.ts[a.ts.length - 1];
    const tStart = tEnd - spanMs;
    const amp = a.sd * 3.5;
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < a.ts.length; i++) {
      if (a.ts[i] < tStart) continue;
      const x = ((a.ts[i] - tStart) / spanMs) * W;
      const y = H / 2 - clamp(a.sd ? a.sig[i] / amp : 0, -1, 1) * (H / 2 - 6);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function pushSample(t, v) {
    st.buf.push({ t, v });
    while (st.buf.length && t - st.buf[0].t > PPG.windowMs) st.buf.shift();
  }

  function refreshUi(force) {
    const now = performance.now();
    if (!force && now - st.lastDraw < PPG.drawEveryMs) return;
    st.lastDraw = now;
    const a = analyze();
    drawWave(a);
    if (a && a.bpm) {
      st.lastBpm = a.bpm;
      if (st.el.bpm) st.el.bpm.textContent = a.bpm;
      if (a.stable && st.mode === 'camera' && !st.applied) {
        st.applied = true;
        applyReading(a.bpm, null, 'FC de ' + a.bpm + ' bpm medida pela câmera.');
      }
    } else if (st.el.bpm) {
      st.el.bpm.textContent = '--';
    }
  }

  /** Grava FC (e, se vier, retorno capilar) e pede um novo diagnóstico. */
  function applyReading(bpm, capillarySec, message) {
    if (Number.isFinite(bpm) && bpm >= 30 && bpm <= 220) setInputValue('input-hr', Math.round(bpm));
    if (Number.isFinite(capillarySec)) setCapillary(capillarySec);
    if (message) setStatus(message);
    requestDiagnosis();
  }

  // ------------------------------------------------------------------ câmera
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Câmera indisponível (abra por http://localhost). Use a simulação.');
      return;
    }
    stopSimulation();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false
      });
      st.stream = stream;
      st.mode = 'camera';
      st.buf = [];
      st.applied = false;
      st.lastBpm = null;
      if (st.el.video) {
        st.el.video.srcObject = stream;
        await st.el.video.play().catch(() => { /* autoplay já cobre */ });
      }
      st.el.camStart.disabled = true;
      st.el.camStop.disabled = false;
      setStatus('Cubra a lente com a ponta do dedo e fique parado.');
      st.raf = requestAnimationFrame(cameraLoop);
    } catch (err) {
      console.warn('[inputs] câmera negada ou ausente:', err);
      setStatus('Sem acesso à câmera. Use "Simular Leitura Óptica" ou a Aba 1.');
    }
  }

  const sampler = document.createElement('canvas');
  sampler.width = 32;
  sampler.height = 32;
  const samplerCtx = sampler.getContext('2d', { willReadFrequently: true });

  function cameraLoop(ts) {
    if (st.mode !== 'camera') return;
    const v = st.el.video;
    if (ts - st.lastSample >= PPG.sampleEveryMs && v && v.readyState >= 2) {
      st.lastSample = ts;
      samplerCtx.drawImage(v, 0, 0, 32, 32);
      const d = samplerCtx.getImageData(0, 0, 32, 32).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      r /= n; g /= n; b /= n;
      const finger = r > 60 && r > g * 1.4 && r > b * 1.4;
      if (finger) {
        pushSample(performance.now(), r);
        if (!st.applied) setStatus('Dedo detectado. Medindo…');
      } else {
        st.buf = [];
        st.applied = false;
        setStatus('Cubra a lente com a ponta do dedo.');
      }
      refreshUi(false);
    }
    st.raf = requestAnimationFrame(cameraLoop);
  }

  function stopCamera() {
    cancelAnimationFrame(st.raf);
    if (st.stream) {
      st.stream.getTracks().forEach((t) => t.stop());
      st.stream = null;
    }
    if (st.el.video) st.el.video.srcObject = null;
    if (st.mode === 'camera') st.mode = 'idle';
    if (st.el.camStart) st.el.camStart.disabled = false;
    if (st.el.camStop) st.el.camStop.disabled = true;
  }

  // -------------------------------------------------------------- simulação
  // Sinal sintético alimentando o MESMO pipeline da câmera.
  function simulate() {
    stopCamera();
    stopSimulation();
    const hr = readNumber('input-hr');
    const target = Number.isFinite(hr) ? clamp(hr, 45, 150) : 72;
    st.mode = 'sim';
    st.buf = [];
    st.lastBpm = null;
    st.applied = true; // só a simulação decide quando aplicar
    if (st.el.sim) st.el.sim.disabled = true;
    setStatus('Simulando leitura óptica…');

    const t0 = performance.now();
    let prev = t0;
    let phase = 0;
    st.simTimer = setInterval(() => {
      const t = performance.now();
      const dt = (t - prev) / 1000;
      prev = t;
      const hrNow = target * (1 + 0.02 * Math.sin((t - t0) / 1800)); // leve variabilidade
      phase = (phase + (dt * hrNow) / 60) % 1;
      const pulse = Math.exp(-(((phase - 0.2) / 0.1) ** 2)) +
                    0.3 * Math.exp(-(((phase - 0.5) / 0.1) ** 2));
      const resp = 1.2 * Math.sin((2 * Math.PI * (t - t0)) / 4000);
      const noise = (Math.random() - 0.5) * 0.8;
      pushSample(t, 190 - 6 * pulse + resp + noise);
      refreshUi(false);

      if (t - t0 >= PPG.simDurationMs) {
        refreshUi(true);
        const detected = st.lastBpm;
        stopSimulation();
        // Aplica a FC simulada (verdade do gerador) para o cenário ativo não mudar de classe
        // por 1-2 bpm de erro de detecção; mostra a detectada para transparência.
        applyReading(Math.round(target), SIM_CAPILLARY_SEC,
          'Simulação concluída: FC ' + Math.round(target) + ' bpm' +
          (detected ? ' (detectada: ' + detected + ')' : '') + ', retorno capilar ' +
          SIM_CAPILLARY_SEC.toFixed(1) + ' s.');
      }
    }, PPG.sampleEveryMs);
  }

  function stopSimulation() {
    if (st.simTimer) { clearInterval(st.simTimer); st.simTimer = 0; }
    if (st.mode === 'sim') st.mode = 'idle';
    if (st.el.sim) st.el.sim.disabled = false;
  }

  // -------------------------------------------------------- retorno capilar
  function currentCapillary() {
    const s = hs();
    const v = s ? Number(s.ppgCapillaryRefillSec) : NaN;
    return Number.isFinite(v) ? v : 1.5;
  }

  function renderCapillary(sec) {
    if (st.el.capLabel) st.el.capLabel.textContent = 'Retorno Capilar: ' + sec.toFixed(1) + 's';
  }

  function setCapillary(sec) {
    const v = Math.round(clamp(sec, 0, CAPILLARY_MAX_SEC) * 10) / 10;
    const s = hs();
    if (s) s.ppgCapillaryRefillSec = v; // escrita permitida ao Dev 5 (README)
    renderCapillary(v);
  }

  function capStart() {
    st.cap.t0 = performance.now();
    st.cap.running = true;
    st.el.capStart.disabled = true;
    st.el.capStop.disabled = false;
    clearInterval(st.cap.timer);
    st.cap.timer = setInterval(() => {
      renderCapillary(clamp((performance.now() - st.cap.t0) / 1000, 0, CAPILLARY_MAX_SEC));
    }, 100);
    setStatus('Contando… clique em "Cor voltou" quando a pele recuperar a cor.');
  }

  function capStop() {
    if (!st.cap.running) return;
    clearInterval(st.cap.timer);
    st.cap.running = false;
    st.el.capStart.disabled = false;
    st.el.capStop.disabled = true;
    const sec = clamp((performance.now() - st.cap.t0) / 1000, 0, CAPILLARY_MAX_SEC);
    setCapillary(sec);
    applyReading(NaN, null, 'Retorno capilar registrado: ' + currentCapillary().toFixed(1) + ' s' +
      (currentCapillary() > 2 ? ' (acima de 2 s).' : '.'));
  }

  // ------------------------------------------------------------------- init
  function init() {
    injectCss();
    setupForm();
    setupOptical();

    // Ao sair da Aba 2 a câmera e a simulação param (privacidade e bateria).
    document.addEventListener('hemospace:tab', (ev) => {
      if (!ev.detail || ev.detail.tab !== 'tab-optical') {
        stopCamera();
        stopSimulation();
      }
    });
    window.addEventListener('pagehide', stopCamera);
  }

  window.Inputs = { stopCamera, simulate };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
