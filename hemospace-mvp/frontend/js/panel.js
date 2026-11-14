/* ==========================================================================
   [STUB — Dev 4 substitui este arquivo]
   Contrato: ClinicalPanel.render(zoneKey, data)  (data = AstronautStateResponse)
   Responsável por: título, badge, gráfico Chart.js (7 dias), texto didático e ações.
   ========================================================================== */
(function () {
  'use strict';

  const TITLES = {
    head_neck: 'Cabeça e Pescoço',
    thorax_heart: 'Tórax e Coração',
    upper_limbs: 'Membros Superiores',
    lower_limbs: 'Membros Inferiores'
  };
  const CLS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };

  function render(zoneKey, data) {
    const zone = data && data.zones && data.zones[zoneKey];
    if (!zone) return;

    const title = document.getElementById('panel-zone-title');
    if (title) title.textContent = 'Diagnóstico: ' + TITLES[zoneKey];

    const badge = document.getElementById('panel-nasa-badge');
    if (badge) {
      badge.textContent = zone.label;
      badge.classList.remove('st-blue', 'st-green', 'st-amber', 'st-red');
      badge.classList.add(CLS[zone.status]);
    }

    const list = document.getElementById('panel-actions-list');
    if (list) {
      list.innerHTML = '';
      const li = document.createElement('li');
      li.textContent = zone.action;
      list.appendChild(li);
    }
  }

  window.ClinicalPanel = { render };
})();
