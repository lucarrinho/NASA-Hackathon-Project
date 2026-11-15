/* ==========================================================================
   HemoSpace v1.0 — ultrasound.js  [Dev 6 · Tab 3: Vascular Ultrasound]

   - 3 samples (assets/ultrasound/*.svg) + upload of your own image;
   - geometric overlay (ellipse + diameter line) drawn on #ultrasound-canvas;
   - classification via ApiClient.classifyUltrasound (Java; falls back to the local rule if offline);
   - stores window.HemoState.ultrasoundPreset and calls HemoApp.runDiagnosis();
   - listens to 'hemospace:preset' to reflect the Scenario A/B/C exam.

   LIMIT: the MVP does NOT analyze the image. The classification comes from the chosen sample
   (or from the exam type the person selects for an uploaded image).
   The overlay is illustrative. Educational simulation, no clinical validity.
   ========================================================================== */
(function () {
  'use strict';

  const W = 320, H = 180;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const COLOR = { BLUE: '#2563EB', GREEN: '#16A34A', YELLOW: '#D97706', RED: '#DC2626' };
  const CLS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };
  const ALL_CLS = Object.values(CLS);

  const SAMPLES = {
    jugular_normal:  { src: 'assets/ultrasound/jugular_normal.svg',  region: 'JUGULAR', name: 'Normal jugular',   vessel: { cx: 160, cy: 95,  rx: 28, ry: 22 } },
    jugular_dilated: { src: 'assets/ultrasound/jugular_dilated.svg', region: 'JUGULAR', name: 'Dilated jugular', vessel: { cx: 160, cy: 95,  rx: 52, ry: 42 } },
    femoral_reduced: { src: 'assets/ultrasound/femoral_reduced.svg', region: 'FEMORAL', name: 'Reduced femoral', vessel: { cx: 160, cy: 100, rx: 14, ry: 10 } }
  };

  const st = { key: null, img: null, custom: null, seq: 0, last: {}, el: {}, cache: {} };
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ UI
  function injectCss() {
    const s = document.createElement('style');
    s.textContent =
      '#ultrasound-result{margin-top:8px;padding:8px 12px;border-left:6px solid var(--st,#475569);' +
      'background:rgba(var(--st-rgb,71,85,105),.16);border-radius:6px;font-size:.95rem}' +
      '#ultrasound-kind-wrap{display:block;margin-top:6px;font-size:.9rem}' +
      '.us-sample-btn.active{outline:3px solid #fff;outline-offset:1px}';
    document.head.appendChild(s);
  }

  function buildUi() {
    const box = $('ultrasound-container');
    if (!box) return false;
    st.el.canvas = $('ultrasound-canvas');
    st.el.upload = $('ultrasound-upload');

    const res = document.createElement('div');
    res.id = 'ultrasound-result';
    res.setAttribute('role', 'status');
    res.setAttribute('aria-live', 'polite');
    box.appendChild(res);
    st.el.result = res;

    const wrap = document.createElement('label');
    wrap.id = 'ultrasound-kind-wrap';
    wrap.hidden = true;
    wrap.textContent = 'Type of uploaded exam (the image is not analyzed automatically): ';
    const sel = document.createElement('select');
    sel.id = 'ultrasound-kind';
    Object.keys(SAMPLES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = SAMPLES[k].name;
      sel.appendChild(o);
    });
    wrap.appendChild(sel);
    box.appendChild(wrap);
    st.el.kindWrap = wrap; st.el.kind = sel;
    return true;
  }

  function setActive(key) {
    document.querySelectorAll('.us-sample-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.sample === key);
    });
  }

  function showResult(r) {
    const el = st.el.result;
    if (!el) return;
    el.classList.remove(...ALL_CLS);
    el.textContent = '';
    if (r.status && CLS[r.status]) el.classList.add(CLS[r.status]);
    const strong = document.createElement('strong');
    strong.textContent = r.label || '';
    el.appendChild(strong);
    if (r.action) el.appendChild(document.createTextNode(' — ' + r.action));
    if (r._offline) el.appendChild(document.createTextNode(' (local rule)'));
  }

  // ------------------------------------------------------------------ canvas
  function draw() {
    const c = st.el.canvas;
    const ctx = c && c.getContext && c.getContext('2d');
    if (!ctx) return;
    ctx.setLineDash([]);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, W, H);

    const img = st.custom || st.img;
    const sample = SAMPLES[st.key];
    if (!img || !sample) {
      ctx.fillStyle = '#9bb0d3';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Choose a sample or upload an image', W / 2, H / 2);
      return;
    }
    const iw = img.naturalWidth || W, ih = img.naturalHeight || H;
    const k = Math.min(W / iw, H / ih);
    ctx.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);

    // illustrative overlay on the vessel
    const v = sample.vessel;
    const color = COLOR[st.last.status] || '#e5e7eb';
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.ellipse(v.cx, v.cy, v.rx + 5, v.ry + 5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(v.cx - v.rx, v.cy); ctx.lineTo(v.cx + v.rx, v.cy);
    ctx.moveTo(v.cx - v.rx, v.cy - 6); ctx.lineTo(v.cx - v.rx, v.cy + 6);
    ctx.moveTo(v.cx + v.rx, v.cy - 6); ctx.lineTo(v.cx + v.rx, v.cy + 6);
    ctx.stroke();
    if (st.last.label) {
      ctx.fillStyle = color; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(st.last.label, 8, H - 8);
    }
  }

  function loadSample(sample) {
    if (st.cache[sample.src]) return Promise.resolve(st.cache[sample.src]);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { st.cache[sample.src] = img; resolve(img); };
      img.onerror = () => resolve(null); // no image: the overlay and classification continue
      img.src = sample.src;
    });
  }

  // ------------------------------------------------------------------ flow
  function toast(msg) {
    if (window.HemoApp && window.HemoApp.showToast) window.HemoApp.showToast(msg);
    else console.warn('[ultrasound]', msg);
  }

  async function select(key, opts) {
    const sample = SAMPLES[key];
    if (!sample) return;
    const seq = ++st.seq;
    st.key = key; st.last = {};
    setActive(st.custom ? null : key);
    if (window.HemoState) window.HemoState.ultrasoundPreset = key;
    showResult({ label: 'Classifying…' });

    if (!st.custom) {
      loadSample(sample).then((img) => { if (seq === st.seq) { st.img = img; draw(); } });
    }
    draw();

    try {
      if (!window.ApiClient || typeof window.ApiClient.classifyUltrasound !== 'function') {
        throw new Error('ApiClient.classifyUltrasound unavailable.');
      }
      const r = await window.ApiClient.classifyUltrasound({ ultrasoundPreset: key });
      if (seq !== st.seq) return;
      st.last = { status: r.status, label: r.label };
      showResult(r);
      draw();
    } catch (err) {
      if (seq !== st.seq) return;
      console.error('[ultrasound] classification failure', err);
      showResult({ label: 'Could not classify the exam.', action: err && err.message });
      return;
    }
    if (opts && opts.diagnose && window.HemoApp && window.HemoApp.runDiagnosis) {
      window.HemoApp.runDiagnosis();
    }
  }

  function clearExam() {
    st.seq++;
    st.key = null; st.img = null; st.custom = null; st.last = {};
    setActive(null);
    if (st.el.kindWrap) st.el.kindWrap.hidden = true;
    showResult({ label: 'No ultrasound exam in this scenario.' });
    draw();
  }

  function onUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Upload an image file.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { toast('Image larger than 5 MB.'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      st.custom = img;
      st.el.kindWrap.hidden = false;
      select(st.el.kind.value, { diagnose: false });
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read the image.'); };
    img.src = url;
  }

  function init() {
    if (!buildUi()) return;
    injectCss();

    document.querySelectorAll('.us-sample-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        st.custom = null;
        st.el.kindWrap.hidden = true;
        select(btn.dataset.sample, { diagnose: true });
      });
    });
    if (st.el.upload) st.el.upload.addEventListener('change', onUpload);
    st.el.kind.addEventListener('change', () => select(st.el.kind.value, { diagnose: true }));

    document.addEventListener('hemospace:preset', (ev) => {
      const key = ev.detail && ev.detail.ultrasoundPreset;
      st.custom = null;
      st.el.kindWrap.hidden = true;
      if (SAMPLES[key]) select(key, { diagnose: false });
      else clearExam();
    });

    const initial = window.HemoState && window.HemoState.ultrasoundPreset;
    if (SAMPLES[initial]) select(initial, { diagnose: false });
    else clearExam();
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
