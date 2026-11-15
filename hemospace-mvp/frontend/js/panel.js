/* ==========================================================================
   panel.js | Dev 4: Clinical Frontend (Panel & Charts)
   Contrato: ClinicalPanel.render(zoneKey, data)   (data = AstronautStateResponse)
   Uses the IDs that already exist in Dev 1's index.html:
     panel-zone-title, panel-nasa-badge, history-chart,
     panel-didactic-box, panel-didactic-text, panel-actions-list
   Uses the styles.css classes: st-blue | st-green | st-amber | st-red | critical
   ========================================================================== */
(function () {
  'use strict';

  const ST_CLASS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };
  const ALL_ST = ['st-blue', 'st-green', 'st-amber', 'st-red'];

  /* Line colors: deliberately neutral (they do not compete with the 4 status colors). */
  const SERIES = {
    map: { label: 'MAP (mmHg)',   color: '#38bdf8', axis: 'y'  },
    hr:  { label: 'HR (bpm)',     color: '#c4b5fd', axis: 'y'  },
    abi: { label: 'ABI (index)', color: '#5eead4', axis: 'y1' }
  };

  /* ---------- Didactic content per zone ---------- */
  const ZONES = {
    head_neck: {
      title: 'Head and Neck',
      hazard: 'Altered gravitational fields (SANS risk)',
      series: ['abi', 'hr'],
      why: 'Without gravity, blood and other fluids shift upward from the legs to the head. ' +
           'The excess fluid raises pressure inside the skull and can affect the optic nerve, ' +
           'impairing vision (SANS syndrome).',
      cause: 'Fluids have shifted upward and are congesting the jugular vein.',
      protocols: [
        'Apply thigh constriction cuffs (Braslet)',
        'Elevate the torso during rest',
        'Perform a follow-up eye exam'
      ]
    },
    thorax_heart: {
      title: 'Thorax and Heart',
      hazard: 'Altered gravitational fields',
      series: ['map', 'hr'],
      why: 'In microgravity, plasma volume drops by about 10–15% and the heart works less. ' +
           'Tracking MAP, pulse pressure and heart rate shows whether the heart is deconditioning.',
      cause: 'Less blood is circulating and the heart is under less demand.',
      protocols: [
        'Maintain daily aerobic exercise',
        'Isotonic hydration if MAP is below 70 mmHg',
        'Suspend extravehicular activity (EVA) if pulse pressure is below 25 mmHg'
      ]
    },
    upper_limbs: {
      title: 'Upper Limbs',
      hazard: 'Hostile, enclosed environment (physiological stress)',
      series: ['map'],
      why: 'The arm is our reference measurement: the pressure measured here feeds the MAP and ABI calculations. ' +
           'It also shows whether blood is reaching the fingertips well.',
      cause: 'Systemic pressure has left the normal range or there is acute cardiovascular stress.',
      protocols: [
        'Rest and sodium reduction if MAP is above 100 mmHg',
        'Repeat the measurement after 5 minutes of rest'
      ]
    },
    lower_limbs: {
      title: 'Lower Limbs',
      hazard: 'Altered gravitational fields (risk of syncope on landing)',
      series: ['abi'],
      why: 'Without gravity, about 2 liters of fluid shift from the legs to the thorax and head. ' +
           'An ABI below 0.90 indicates a circulation deficit in the legs and a high risk of fainting on return to gravity.',
      cause: 'Fluid has left the legs and blood reaches the ankle at lower pressure.',
      protocols: [
        '20-min session in the LBNP chamber (lower body negative pressure)',
        'Lower-limb resistance exercise',
        'Drink 500 ml of electrolyte solution before gravitational transitions'
      ]
    }
  };

  let chart = null;
  const $ = (id) => document.getElementById(id);

  /* ---------- 7-day history ---------- */
  /* The backend sends data.history = [{ mission_day, map_mmhg, abi_index, heart_rate_bpm } x7].
     The "Today" point is overwritten with the current reading (computed_metrics), so the chart
     follows what the user just measured or the loaded scenario. */
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

  /* ---------- Chart ---------- */
  function drawChart(zoneKey, data) {
    const canvas = $('history-chart');
    if (!canvas) return;
    const cfg = ZONES[zoneKey];
    const pts = getSeries(data);
    const wrap = canvas.parentElement;

    /* Fallback if Chart.js did not load (internet down) or if there is no data */
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
        ? 'Chart unavailable. Today: MAP ' + last.map + ' mmHg · ABI ' + last.abi + ' · HR ' + last.hr + ' bpm'
        : 'No history available.';
      return;
    }
    canvas.style.display = '';
    if (fb) fb.remove();

    const labels = pts.map((p, i) => (i === pts.length - 1 ? 'Today' : 'Day ' + p.day));
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
      hidden: !cfg.series.includes(key) /* the others can be enabled via the legend */
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
            title: { display: true, text: 'ABI', color: text, font: { size: 13 } },
            ticks: { color: text, font: { size: 13 } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  /* ---------- Didactic block ---------- */
  function fillDidactic(cfg, isAlert) {
    const text = $('panel-didactic-text');
    if (text) text.textContent = cfg.why;

    const box = $('panel-didactic-box');
    if (!box) return;

    /* NASA hazard line (created here to avoid touching index.html) */
    let hz = $('panel-hazard');
    if (!hz) {
      hz = document.createElement('p');
      hz.id = 'panel-hazard';
      hz.style.cssText = 'margin-top:.5rem;font-size:.9rem;opacity:.85';
      box.appendChild(hz);
    }
    hz.textContent = 'NASA Hazard: ' + cfg.hazard;

    /* Mandatory rule: yellow/red shows physiological cause + protocol together */
    let cause = $('panel-cause');
    if (!cause) {
      cause = document.createElement('p');
      cause.id = 'panel-cause';
      cause.style.cssText = 'margin-top:.5rem;font-weight:700';
      box.appendChild(cause);
    }
    cause.hidden = !isAlert;
    cause.textContent = isAlert ? 'Probable cause: ' + cfg.cause : '';
  }

  /* ---------- Actions and countermeasures ---------- */
  function fillActions(zone, cfg, isAlert) {
    const list = $('panel-actions-list');
    if (!list) return;
    list.innerHTML = '';

    const main = document.createElement('li');
    if (isAlert) main.className = 'critical'; /* class already styled in styles.css */
    const tag = document.createElement('strong');
    tag.textContent = 'Immediate action: ';
    main.appendChild(tag);
    main.appendChild(document.createTextNode(zone.action || 'No intervention required.'));
    list.appendChild(main);

    /* Extra countermeasures only when the zone is not green */
    if (zone.status !== 'GREEN') {
      cfg.protocols.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p;
        list.appendChild(li);
      });
    }
  }

  /* ---------- Public API ---------- */
  function render(zoneKey, data) {
    const cfg = ZONES[zoneKey];
    const zone = data && data.zones && data.zones[zoneKey];
    if (!cfg || !zone) return;

    const isAlert = zone.status === 'YELLOW' || zone.status === 'RED';

    const title = $('panel-zone-title');
    if (title) title.textContent = 'Diagnosis: ' + cfg.title;

    const badge = $('panel-nasa-badge');
    if (badge) {
      badge.textContent = zone.label;
      badge.classList.remove(...ALL_ST);
      badge.classList.add(ST_CLASS[zone.status] || 'st-green');
    }

    /* The actions block border uses the status color via --st (styles.css) */
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
  window.updateClinicalPanel = render; /* alias used in Dev 4's specification */
})();
