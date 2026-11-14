/* ==========================================================================
   [STUB — Dev 5 substitui este arquivo]
   Existe só para o skeleton rodar de ponta a ponta no Check-in 1.
   Contrato mantido: ApiClient.postReading(payload) -> Promise<AstronautStateResponse>
   Fallback offline: se o Java não responder em 500 ms, calcula localmente (Regra 2).
   Marca a resposta local com _offline: true (app.js mostra o indicador "Modo offline").
   ========================================================================== */
(function () {
  'use strict';

  const BASE_URL = 'http://localhost:8080/api/v1';
  const TIMEOUT_MS = 500;

  const STATUS_ORDER = { GREEN: 0, BLUE: 1, YELLOW: 2, RED: 3 };
  const worst = (...s) => s.reduce((a, b) => (STATUS_ORDER[b] > STATUS_ORDER[a] ? b : a), 'GREEN');

  // Textos provisórios (Dev 2/Dev 6 calibram os definitivos)
  const TEXT = {
    head_neck: {
      GREEN:  ['Sem Congestão Cefálica', 'Manter rotina e monitoramento visual.'],
      YELLOW: ['Congestão Cefálica Leve', 'Iniciar LBNP 20 min e monitorar visão.'],
      RED:    ['Congestão Cefálica Severa (risco SANS)', 'LBNP imediato, elevar tronco e realizar exame ocular.']
    },
    thorax_heart: {
      GREEN:  ['Débito Cardíaco Estável', 'Manter rotina aeróbica padrão.'],
      BLUE:   ['PAM Baixa', 'Hidratação isotônica e repouso.'],
      YELLOW: ['Risco de Intolerância Ortostática', 'Pré-hidratação e reavaliar antes de transição gravitacional.'],
      RED:    ['Hipovolemia (PP baixa)', 'Reposição volêmica urgente e suspender EVA.']
    },
    upper_limbs: {
      GREEN:  ['Perfusão Sistêmica Normal', 'Nenhuma intervenção necessária.'],
      BLUE:   ['Hipotensão Sistêmica', 'Hidratação isotônica.'],
      YELLOW: ['Pressão Sistêmica Elevada', 'Repouso e redução de sódio.']
    },
    lower_limbs: {
      GREEN:  ['Perfusão Distal Normal', 'Nenhuma intervenção necessária.'],
      BLUE:   ['Déficit de Volume Distal', 'Executar protocolo de pré-hidratação e LBNP.'],
      YELLOW: ['ITB Elevado', 'Avaliar rigidez arterial com o médico de voo.']
    }
  };

  function zone(key, status) {
    const t = TEXT[key][status] || TEXT[key].GREEN;
    return { status, label: t[0], action: t[1] };
  }

  function computeLocal(p) {
    const pam = (p.armSystolicMmhg + 2 * p.armDiastolicMmhg) / 3;
    const abi = p.ankleSystolicMmhg / p.armSystolicMmhg;
    const pp = p.armSystolicMmhg - p.armDiastolicMmhg;

    const pamS = pam < 70 ? 'BLUE' : pam > 100 ? 'YELLOW' : 'GREEN';
    const abiS = abi < 0.9 ? 'BLUE' : abi > 1.3 ? 'YELLOW' : 'GREEN';
    const ppS = pp < 25 ? 'RED' : pp > 60 ? 'YELLOW' : 'GREEN';
    const jugularDilated = p.ultrasoundPreset === 'jugular_dilated';

    const head = abi < 0.9 && jugularDilated ? 'RED' : jugularDilated ? 'YELLOW' : 'GREEN';
    let thorax = worst(pamS, ppS);
    // heurística provisória para o Cenário C (spec §5): ITB baixo + taquicardia
    if (thorax === 'GREEN' && abi < 0.9 && p.heartRateBpm > 95) thorax = 'YELLOW';
    const lower = abiS === 'GREEN' && p.calfCircumferenceCm <= -2 ? 'BLUE' : abiS;

    return {
      astronaut_id: p.astronautId,
      mission_day: 42,
      gravity_profile: p.gravityProfile,
      computed_metrics: {
        map_mmhg: Math.round(pam * 10) / 10,
        abi_index: Math.round(abi * 100) / 100,
        pulse_pressure_mmhg: pp
      },
      zones: {
        head_neck: zone('head_neck', head),
        thorax_heart: zone('thorax_heart', thorax),
        upper_limbs: zone('upper_limbs', pamS),
        lower_limbs: zone('lower_limbs', lower)
      },
      _offline: true
    };
  }

  async function postReading(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(BASE_URL + '/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      return computeLocal(payload);
    } finally {
      clearTimeout(timer);
    }
  }

  window.ApiClient = { BASE_URL, postReading, computeLocal };
})();
