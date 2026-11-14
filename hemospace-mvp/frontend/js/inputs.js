/* ==========================================================================
   [STUB — Dev 5 implementa]
   Aba 1 (form numérico — ids já definidos no index.html) e Aba 2 (Webcam PPG).

   Pontos de integração com o app.js (Dev 1):
   - Ao concluir uma leitura óptica, gravar o resultado em
       window.HemoState.ppgCapillaryRefillSec = <segundos>;
   - Evento 'hemospace:tab' (detail.tab) avisa quando a aba muda:
       document.addEventListener('hemospace:tab', e => { ... ligar/desligar getUserMedia ... });
   - Para forçar um novo diagnóstico após a leitura:
       window.HemoApp.runDiagnosis();
   ========================================================================== */
