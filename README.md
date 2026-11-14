# HemoSpace MVP — Monitor Hemodinâmico Regional

Contrato de integração mantido pelo Dev 1. Detalhes completos na Especificação Técnica (PDF).

## Como rodar

```bash
# Backend (porta 8080)
cd backend-java && mvn spring-boot:run

# Frontend: abrir frontend/index.html direto no navegador
# (ou servir com Live Server / `python3 -m http.server 5500` dentro de frontend/)
```

Se o Java estiver fora do ar, `api.js` cai no cálculo local após 500 ms e o topo mostra **"Modo offline"**.

## Propriedade de pastas

| Dev | Arquivos |
|-----|----------|
| 1 | `HemospaceApplication`, `config/CorsConfig`, `index.html` (estrutura), `css/styles.css`, `js/app.js` |
| 2 | `model/`, `service/`, `controller/`, `clinical_rules.json`, `astronaut_history.json` |
| 3 | SVG em `#bodymap-slot`, `js/bodymap.js` |
| 4 | painel direito (`#clinical-panel`), `js/panel.js` |
| 5 | `js/api.js`, `js/inputs.js` |
| 6 | `js/ultrasound.js`, `assets/ultrasound/` |

`api.js`, `bodymap.js`, `panel.js`, `inputs.js` e `ultrasound.js` estão como **stubs** marcados no topo — substituam o arquivo inteiro.

## Funções globais (contrato)

| Quem expõe | Assinatura | Quem chama |
|------------|-----------|-----------|
| Dev 5 | `ApiClient.postReading(payload) -> Promise<AstronautStateResponse>` | app.js |
| Dev 5 (opcional) | `ApiClient.loadPreset(code)` — só usado se `USE_BACKEND_PRESETS = true` em app.js | app.js |
| Dev 3 | `BodyMap.render(zones, gravityProfile)` | app.js |
| Dev 4 | `ClinicalPanel.render(zoneKey, data)` | app.js |
| Dev 1 | `window.selectZone(zoneKey)` — chaves: `head_neck`, `thorax_heart`, `upper_limbs`, `lower_limbs` | bodymap.js, cards |
| Dev 1 | `window.HemoApp.runDiagnosis()` | inputs.js / ultrasound.js |

Opcional em `ApiClient.postReading`: devolver `_offline: true` na resposta calculada localmente (liga o indicador de modo offline).

## Estado compartilhado (`window.HemoState`)

`gravityProfile`, `selectedZone`, `data` (última resposta), `lastPayload`, `activePreset`, `offline` — somente leitura para os outros devs.

Escrita permitida:
- `ppgCapillaryRefillSec` (número, s) — **Dev 5** após leitura óptica
- `ultrasoundPreset` (`'jugular_normal' | 'jugular_dilated' | 'femoral_reduced' | 'NONE'`) — **Dev 6**

## Eventos (`document.addEventListener`)

`hemospace:tab` `{tab}` · `hemospace:gravity` `{gravityProfile}` · `hemospace:preset` `{code, ultrasoundPreset}` · `hemospace:zone` `{zoneKey}`

## Payload enviado (`POST /api/v1/readings`) — camelCase, igual ao record `ReadingRequest`

```json
{ "astronautId": "AST-04", "gravityProfile": "0G_ORBIT",
  "armSystolicMmhg": 118, "armDiastolicMmhg": 76, "ankleSystolicMmhg": 112,
  "heartRateBpm": 68, "calfCircumferenceCm": 0.0,
  "ppgCapillaryRefillSec": 1.5, "ultrasoundPreset": "NONE" }
```

A **resposta** é snake_case (`astronaut_id`, `computed_metrics`, `zones`…). Dev 2: usar `@JsonProperty` nos records de resposta (ou um DTO separado) para não quebrar a entrada camelCase.

## Classes e cores

`.st-blue` `#2563EB` · `.st-green` `#16A34A` · `.st-amber` `#D97706` · `.st-red` `#DC2626`. Mapeamento: `YELLOW` → `st-amber`.
No SVG (Dev 3): `<g id="zone-head" class="zone st-green">` já herda a cor via CSS.
