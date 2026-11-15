// Testes do frontend: carrega o index.html real num DOM simulado (jsdom), com o Java "fora do ar"
// (fetch rejeitado -> api.js usa o motor local). Execução: npm install && npm test
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const INDEX = path.resolve(__dirname, '..', 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ZONE_IDS = { head_neck: 'zone-head', thorax_heart: 'zone-thorax', upper_limbs: 'zone-arms', lower_limbs: 'zone-legs' };

async function loadPage() {
  const dom = await JSDOM.fromFile(INDEX, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(), // silencia erros de rede/canvas do jsdom
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error('offline'));
      w.URL.createObjectURL = () => 'blob:test';
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : () => {}),
        set: (t, k, v) => { t[k] = v; return true; }
      });
    }
  });
  await sleep(900); // load + diagnóstico inicial
  return dom.window;
}
const statusOf = (w, id) => [...w.document.getElementById(id).classList].filter((c) => c.startsWith('st-'));
const zoneState = (w) => Object.values(ZONE_IDS).map((id) => statusOf(w, id).join(''));

test('SVG tem os 4 grupos com id e data-zone corretos', async () => {
  const w = await loadPage();
  for (const [key, id] of Object.entries(ZONE_IDS)) {
    const el = w.document.getElementById(id);
    assert.ok(el, id + ' existe');
    assert.equal(el.dataset.zone, key);
    assert.equal(w.document.querySelectorAll('#' + id).length, 1, 'id único');
  }
  w.close();
});

test('BodyMap.render pinta os 4 estados e troca a classe antiga', async () => {
  const w = await loadPage();
  const z = (s) => ({ status: s });
  w.BodyMap.render({ head_neck: z('BLUE'), thorax_heart: z('GREEN'), upper_limbs: z('YELLOW'), lower_limbs: z('RED') }, '0G_ORBIT');
  assert.deepEqual(zoneState(w), ['st-blue', 'st-green', 'st-amber', 'st-red']);
  w.BodyMap.render({ head_neck: z('RED'), thorax_heart: z('RED'), upper_limbs: z('GREEN'), lower_limbs: z('BLUE') }, '0G_ORBIT');
  assert.deepEqual(zoneState(w), ['st-red', 'st-red', 'st-green', 'st-blue']);
  w.close();
});

test('status ausente/desconhecido não inventa cor', async () => {
  const w = await loadPage();
  w.BodyMap.render({ head_neck: { status: 'XYZ' }, thorax_heart: {}, upper_limbs: { status: 'GREEN' }, lower_limbs: { status: 'GREEN' } }, '0G_ORBIT');
  assert.deepEqual(statusOf(w, 'zone-head'), []);
  assert.equal(w.document.getElementById('zone-head').dataset.status, 'UNKNOWN');
  assert.deepEqual(statusOf(w, 'zone-thorax'), []);
  w.close();
});

test('regra visual de gravidade: 0g, Lua, Marte e 1g', async () => {
  const w = await loadPage();
  const all = { head_neck: { status: 'GREEN' }, thorax_heart: { status: 'GREEN' }, upper_limbs: { status: 'GREEN' }, lower_limbs: { status: 'GREEN' } };
  const shown = (id) => w.document.getElementById(id).getAttribute('display') !== 'none';
  const op = (id) => Number(w.document.getElementById(id).getAttribute('opacity'));
  const partial = (id) => w.document.getElementById(id).classList.contains('flow-partial');

  w.BodyMap.render(all, '0G_ORBIT');
  assert.ok(shown('flow-up') && !shown('flow-down'));
  w.BodyMap.render(all, '1G_EARTH');
  assert.ok(!shown('flow-up') && shown('flow-down') && !partial('flow-down') && op('flow-down') === 1);
  w.BodyMap.render(all, '1_6G_MOON');
  const moon = op('flow-down');
  assert.ok(shown('flow-down') && partial('flow-down'));
  w.BodyMap.render(all, '3_8G_MARS');
  const mars = op('flow-down');
  assert.ok(shown('flow-down') && partial('flow-down'));
  assert.ok(moon < mars && mars < 1, 'Lua < Marte < 1g');
  assert.match(w.document.getElementById('gravity-label').textContent, /3\/8 g/);
  w.close();
});

test('clique, Enter e Espaço chamam selectZone com a chave lógica', async () => {
  const w = await loadPage();
  const calls = [];
  w.selectZone = (k) => calls.push(k);
  for (const [key, id] of Object.entries(ZONE_IDS)) {
    const el = w.document.getElementById(id);
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    assert.deepEqual(calls.splice(0), [key, key, key]);
  }
  w.close();
});

test('batimento: duração = 60/bpm e valor inválido desliga', async () => {
  const w = await loadPage();
  const heart = w.document.querySelector('#zone-thorax .heart-pulse');
  w.BodyMap.setHeartRate(60);
  assert.equal(heart.style.getPropertyValue('--beat-duration'), '1s');
  w.BodyMap.setHeartRate(90);
  assert.ok(Math.abs(parseFloat(heart.style.getPropertyValue('--beat-duration')) - 0.6667) < 0.001);
  w.BodyMap.setHeartRate('abc');
  assert.ok(!heart.classList.contains('is-beating'));
  w.close();
});

test('cenários A, B e C pelos botões do topo', async () => {
  const w = await loadPage();
  const run = async (c) => { w.document.querySelector('[data-preset="' + c + '"]').click(); await sleep(700); return zoneState(w); };
  assert.deepEqual(await run('A'), ['st-green', 'st-green', 'st-green', 'st-green']);
  assert.deepEqual(await run('B'), ['st-red', 'st-amber', 'st-amber', 'st-blue']);
  assert.deepEqual(await run('C'), ['st-amber', 'st-amber', 'st-green', 'st-blue']);
  w.close();
});

test('motor local confere A/B/C e adaptações para o backend', async () => {
  const w = await loadPage();
  assert.equal(w.ApiClient.selfTest(), true);
  const p = w.ApiClient.toBackendPayload({
    astronautId: 'AST-04', gravityProfile: '0G_ORBIT', armSystolicMmhg: 96, armDiastolicMmhg: 68,
    ankleSystolicMmhg: 84, heartRateBpm: 98, calfCircumferenceCm: -2.4, ppgCapillaryRefillSec: 1.5,
    ultrasoundPreset: 'jugular_dilated'
  });
  assert.equal(p.ultrasoundPreset, 'DILATED');
  assert.ok(Math.abs(p.calfCircumferenceCm - 32.6) < 1e-9);
  assert.equal(w.ApiClient.toBackendPayload({ ...p, ultrasoundPreset: 'NONE', calfCircumferenceCm: 0 }).ultrasoundPreset, 'NORMAL');
  w.close();
});

test('ultrassom: amostra classifica, grava o preset e atualiza a cabeça', async () => {
  const w = await loadPage();
  w.document.querySelector('.us-sample-btn[data-sample="jugular_dilated"]').click();
  await sleep(900);
  assert.equal(w.HemoState.ultrasoundPreset, 'jugular_dilated');
  assert.match(w.document.getElementById('ultrasound-result').textContent, /jugular detectada/i);
  assert.deepEqual(statusOf(w, 'zone-head'), ['st-amber']); // cenário A + jugular dilatada
  w.close();
});

test('ultrassom: Cenário B reflete a amostra e Cenário C mostra "sem exame"', async () => {
  const w = await loadPage();
  w.document.querySelector('[data-preset="B"]').click();
  await sleep(800);
  assert.equal(w.HemoState.ultrasoundPreset, 'jugular_dilated');
  assert.ok(w.document.querySelector('.us-sample-btn[data-sample="jugular_dilated"]').classList.contains('active'));
  w.document.querySelector('[data-preset="C"]').click();
  await sleep(800);
  assert.match(w.document.getElementById('ultrasound-result').textContent, /Sem exame/);
  w.close();
});
