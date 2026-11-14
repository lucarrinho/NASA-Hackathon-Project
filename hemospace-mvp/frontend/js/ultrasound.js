/* ==========================================================================
   [STUB — Dev 6 implementa]
   Aba 3: upload/amostras de ultrassom + overlay no <canvas id="ultrasound-canvas">
   + POST /api/v1/ultrasound/classify.

   Pontos de integração com o app.js (Dev 1):
   - Ao escolher uma amostra/classificar, gravar
       window.HemoState.ultrasoundPreset = 'jugular_normal' | 'jugular_dilated' | 'femoral_reduced' | 'NONE';
   - Evento 'hemospace:preset' (detail.ultrasoundPreset) avisa quando um Cenário A/B/C
     foi carregado, para a Aba 3 refletir a amostra correspondente.
   ========================================================================== */
(function () {
  'use strict';

  // Mínimo para o skeleton: clicar numa amostra já alimenta o payload.
  document.querySelectorAll('.us-sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.HemoState.ultrasoundPreset = btn.dataset.sample;
      document.querySelectorAll('.us-sample-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
})();
