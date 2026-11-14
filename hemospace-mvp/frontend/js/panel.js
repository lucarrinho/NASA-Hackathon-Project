/* ==========================================================================
   panel.js | Dev 4: Frontend Clínico (Painel & Gráficos)
   Contrato: ClinicalPanel.render(zoneKey, data)   (data = AstronautStateResponse)
   Usa os IDs que já existem no index.html do Dev 1:
     panel-zone-title, panel-nasa-badge, history-chart,
     panel-didactic-box, panel-didactic-text, panel-actions-list
   Usa as classes do styles.css: st-blue | st-green | st-amber | st-red | critical
   ========================================================================== */
(function () {
  'use strict';

  const ST_CLASS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };
  const ALL_ST = ['st-blue', 'st-green', 'st-amber', 'st-red'];

  /* Cores das linhas: neutras de propósito (não competem com as 4 cores de status). */
  const SERIES = {
    map: { label: 'PAM (mmHg)',   color: '#38bdf8', axis: 'y'  },
    hr:  { label: 'FC (bpm)',     color: '#c4b5fd', axis: 'y'  },
    abi: { label: 'ITB (índice)', color: '#5eead4', axis: 'y1' }
  };

  /* ---------- Conteúdo didático por zona ---------- */
  const ZONES = {
    head_neck: {
      title: 'Cabeça e Pescoço',
      hazard: 'Campos gravitacionais alterados (risco SANS)',
      series: ['abi', 'hr'],
      why: 'Sem gravidade, o sangue e outros fluidos sobem das pernas para a cabeça. ' +
           'O excesso de fluido aumenta a pressão dentro do crânio e pode afetar o nervo óptico, ' +
           'prejudicando a visão (síndrome SANS).',
      cause: 'Os fluidos migraram para cima e estão congestionando a veia jugular.',
      protocols: [
        'Aplicar cintas de contenção nas coxas (Braslet)',
        'Elevar o tronco durante o repouso',
        'Realizar exame ocular de controle'
      ]
    },
    thorax_heart: {
      title: 'Tórax e Coração',
      hazard: 'Campos gravitacionais alterados',
      series: ['map', 'hr'],
      why: 'Em microgravidade o volume de plasma cai cerca de 10–15% e o coração trabalha menos. ' +
           'Acompanhar PAM, pressão de pulso e frequência cardíaca mostra se o coração está perdendo condicionamento.',
      cause: 'Há menos sangue circulando e o coração está menos exigido.',
      protocols: [
        'Manter exercício aeróbico diário',
        'Hidratação isotônica se a PAM estiver abaixo de 70 mmHg',
        'Suspender atividade extraveicular (EVA) se a pressão de pulso estiver abaixo de 25 mmHg'
      ]
    },
    upper_limbs: {
      title: 'Membros Superiores',
      hazard: 'Ambiente hostil e fechado (estresse fisiológico)',
      series: ['map'],
      why: 'O braço é a nossa medida de referência: a pressão medida aqui alimenta o cálculo da PAM e do ITB. ' +
           'Ela também mostra se o sangue chega bem à ponta dos dedos.',
      cause: 'A pressão sistêmica saiu da faixa normal ou há estresse cardiovascular agudo.',
      protocols: [
        'Repouso e redução de sódio se a PAM estiver acima de 100 mmHg',
        'Repetir a medição após 5 minutos de repouso'
      ]
    },
    lower_limbs: {
      title: 'Membros Inferiores',
      hazard: 'Campos gravitacionais alterados (risco de síncope no pouso)',
      series: ['abi'],
      why: 'Sem gravidade, cerca de 2 litros de fluido migram das pernas para o tórax e a cabeça. ' +
           'Um ITB abaixo de 0,90 indica déficit de circulação nas pernas e alto risco de desmaio ao voltar à gravidade.',
      cause: 'O fluido saiu das pernas e o sangue chega ao tornozelo com menos pressão.',
      protocols: [
        'Sessão de 20 min na câmara LBNP (pressão negativa inferior)',
        'Exercício resistido de membros inferiores',
        'Ingerir 500 ml de solução eletrolítica antes de transições gravitacionais'
      ]
    }
  };

  let chart = null;
  const $ = (id) => document.getElementById(id);

  /* ---------- Histórico de 7 dias ---------- */
  /* O backend manda data.history = [{ mission_day, map_mmhg, abi_index, heart_rate_bpm } x7].
     O ponto "Hoje" é sobrescrito com a leitura atual (computed_metrics), para o gráfico
     acompanhar o que o usuário acabou de medir ou o cenário carregado. */
  function getSeries(data) {
    const src = Array.isArray(data.history) ? data.history.slice(-7) : [];
    const pts = src.map((h) => ({
      day: h.mission_day ?? h.day,
      map: h.map_mmhg,
      abi: h.abi_index,
      hr: h.heart_rate_bpm
    }));

    const cm = data.computed_metrics;
    const st = window.HemoState || {};
    const hrNow = (st.lastPayload && st.lastPayload.heartRateBpm) || (pts.length ? pts[pts.length - 1].hr : null);

    if (cm) {
      const today = {
        day: data.mission_day,
        map: +Number(cm.map_mmhg).toFixed(1),
        abi: +Number(cm.abi_index).toFixed(2),
        hr: hrNow
      };
      if (pts.length) pts[pts.length - 1] = today; else pts.push(today);
    }
    return pts;
  }

  /* ---------- Gráfico ---------- */
  function drawChart(zoneKey, data) {
    const canvas = $('history-chart');
    if (!canvas) return;
    const cfg = ZONES[zoneKey];
    const pts = getSeries(data);
    const wrap = canvas.parentElement;

    /* Fallback se o Chart.js não carregou (internet caiu) ou se não há dados */
    let fb = $('panel-chart-fallback');
    if (typeof Chart === 'undefined' || !pts.length) {
      canvas.style.display = 'none';
      if (!fb) {
        fb = document.createElement('p');
        fb.id = 'panel-chart-fallback';
        wrap.appendChild(fb);
      }
      const last = pts[pts.length - 1];
      fb.textContent = last
        ? 'Gráfico indisponível. Hoje: PAM ' + last.map + ' mmHg · ITB ' + last.abi + ' · FC ' + last.hr + ' bpm'
        : 'Sem histórico disponível.';
      return;
    }
    canvas.style.display = '';
    if (fb) fb.remove();

    const labels = pts.map((p, i) => (i === pts.length - 1 ? 'Hoje' : 'Dia ' + p.day));
    const datasets = Object.keys(SERIES).map((key) => ({
      label: SERIES[key].label,
      data: pts.map((p) => p[key]),
      borderColor: SERIES[key].color,
      backgroundColor: SERIES[key].color,
      yAxisID: SERIES[key].axis,
      borderWidth: 3,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.25,
      hidden: !cfg.series.includes(key) /* as outras ficam ativáveis pela legenda */
    }));

    const text = '#e8eefb';
    const grid = '#25365a';
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: reduce ? 0 : 350 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { color: text, font: { size: 14 }, boxWidth: 16 } },
          tooltip: { titleFont: { size: 14 }, bodyFont: { size: 14 } }
        },
        scales: {
          x: { ticks: { color: text, font: { size: 13 } }, grid: { color: grid } },
          y: {
            position: 'left',
            title: { display: true, text: 'mmHg / bpm', color: text, font: { size: 13 } },
            ticks: { color: text, font: { size: 13 } },
            grid: { color: grid }
          },
          y1: {
            position: 'right',
            min: 0.5,
            max: 1.5,
            title: { display: true, text: 'ITB', color: text, font: { size: 13 } },
            ticks: { color: text, font: { size: 13 } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  /* ---------- Bloco didático ---------- */
  function fillDidactic(cfg, isAlert) {
    const text = $('panel-didactic-text');
    if (text) text.textContent = cfg.why;

    const box = $('panel-didactic-box');
    if (!box) return;

    /* Linha do perigo NASA (criada aqui para não precisar mexer no index.html) */
    let hz = $('panel-hazard');
    if (!hz) {
      hz = document.createElement('p');
      hz.id = 'panel-hazard';
      hz.style.cssText = 'margin-top:.5rem;font-size:.9rem;opacity:.85';
      box.appendChild(hz);
    }
    hz.textContent = 'Perigo NASA: ' + cfg.hazard;

    /* Regra obrigatória: amarelo/vermelho mostra causa fisiológica + protocolo juntos */
    let cause = $('panel-cause');
    if (!cause) {
      cause = document.createElement('p');
      cause.id = 'panel-cause';
      cause.style.cssText = 'margin-top:.5rem;font-weight:700';
      box.appendChild(cause);
    }
    cause.hidden = !isAlert;
    cause.textContent = isAlert ? 'Causa provável: ' + cfg.cause : '';
  }

  /* ---------- Ações e contramedidas ---------- */
  function fillActions(zone, cfg, isAlert) {
    const list = $('panel-actions-list');
    if (!list) return;
    list.innerHTML = '';

    const main = document.createElement('li');
    if (isAlert) main.className = 'critical'; /* classe já estilizada no styles.css */
    const tag = document.createElement('strong');
    tag.textContent = 'Ação imediata: ';
    main.appendChild(tag);
    main.appendChild(document.createTextNode(zone.action || 'Nenhuma intervenção necessária.'));
    list.appendChild(main);

    /* Contramedidas extras só quando a zona não está verde */
    if (zone.status !== 'GREEN') {
      cfg.protocols.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p;
        list.appendChild(li);
      });
    }
  }

  /* ---------- API pública ---------- */
  function render(zoneKey, data) {
    const cfg = ZONES[zoneKey];
    const zone = data && data.zones && data.zones[zoneKey];
    if (!cfg || !zone) return;

    const isAlert = zone.status === 'YELLOW' || zone.status === 'RED';

    const title = $('panel-zone-title');
    if (title) title.textContent = 'Diagnóstico: ' + cfg.title;

    const badge = $('panel-nasa-badge');
    if (badge) {
      badge.textContent = zone.label;
      badge.classList.remove(...ALL_ST);
      badge.classList.add(ST_CLASS[zone.status] || 'st-green');
    }

    /* A borda do bloco de ações usa a cor do status via --st (styles.css) */
    const actionsBox = $('panel-actions-box');
    if (actionsBox) {
      actionsBox.classList.remove(...ALL_ST);
      actionsBox.classList.add(ST_CLASS[zone.status] || 'st-green');
    }

    fillDidactic(cfg, isAlert);
    fillActions(zone, cfg, isAlert);
    drawChart(zoneKey, data);
  }

  window.ClinicalPanel = { render };
  window.updateClinicalPanel = render; /* alias usado na especificação do Dev 4 */
})();
