/* ==========================================================================
   [STUB — Dev 3 substitui este arquivo]
   Contrato: BodyMap.render(zones, gravityProfile)
   Ao clicar numa região do SVG, chamar window.selectZone(zoneKey)
   (chaves: head_neck | thorax_heart | upper_limbs | lower_limbs).
   ========================================================================== */
(function () {
  'use strict';

  const SVG_IDS = {
    head_neck: 'zone-head',
    thorax_heart: 'zone-thorax',
    upper_limbs: 'zone-arms',
    lower_limbs: 'zone-legs'
  };
  const CLS = { BLUE: 'st-blue', GREEN: 'st-green', YELLOW: 'st-amber', RED: 'st-red' };

  function render(zones /*, gravityProfile */) {
    Object.keys(SVG_IDS).forEach((key) => {
      const el = document.getElementById(SVG_IDS[key]);
      if (!el || !zones[key]) return;
      el.classList.remove('st-blue', 'st-green', 'st-amber', 'st-red');
      el.classList.add(CLS[zones[key].status]);
    });
  }

  window.BodyMap = { render };
})();
