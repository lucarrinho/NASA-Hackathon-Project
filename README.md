# HemoSpace MVP — Regional Hemodynamic Monitor

Integration contract maintained by Dev 1. Full details in the Technical Specification (PDF).

## How to run

```bash
# Backend (port 8080)
cd backend-java && mvn spring-boot:run

# Frontend: open frontend/index.html directly in the browser
# (or serve with Live Server / `python3 -m http.server 5500` inside frontend/)
```

If Java is down, `api.js` falls back to local calculation after 500 ms and the top bar shows **"Offline mode"**.

## Folder ownership

| Dev | Files |
|-----|----------|
| 1 | `HemospaceApplication`, `config/CorsConfig`, `index.html` (structure), `css/styles.css`, `js/app.js` |
| 2 | `model/`, `service/`, `controller/`, `clinical_rules.json`, `astronaut_history.json` |
| 3 | SVG in `#bodymap-slot`, `js/bodymap.js` |
| 4 | right panel (`#clinical-panel`), `js/panel.js` |
| 5 | `js/api.js`, `js/inputs.js` |
| 6 | `js/ultrasound.js`, `assets/ultrasound/` |

`api.js`, `bodymap.js`, `panel.js`, `inputs.js` and `ultrasound.js` are **stubs** marked at the top — replace the entire file.

## Global functions (contract)

| Exposed by | Signature | Called by |
|------------|-----------|-----------|
| Dev 5 | `ApiClient.postReading(payload) -> Promise<AstronautStateResponse>` | app.js |
| Dev 5 (optional) | `ApiClient.loadPreset(code)` — only used if `USE_BACKEND_PRESETS = true` in app.js | app.js |
| Dev 3 | `BodyMap.render(zones, gravityProfile)` | app.js |
| Dev 4 | `ClinicalPanel.render(zoneKey, data)` | app.js |
| Dev 1 | `window.selectZone(zoneKey)` — keys: `head_neck`, `thorax_heart`, `upper_limbs`, `lower_limbs` | bodymap.js, cards |
| Dev 1 | `window.HemoApp.runDiagnosis()` | inputs.js / ultrasound.js |

Optional in `ApiClient.postReading`: return `_offline: true` in the locally computed response (turns on the offline-mode indicator).

## Shared state (`window.HemoState`)

`gravityProfile`, `selectedZone`, `data` (latest response), `lastPayload`, `activePreset`, `offline` — read-only for the other devs.

Write access allowed:
- `ppgCapillaryRefillSec` (number, s) — **Dev 5** after the optical reading
- `ultrasoundPreset` (`'jugular_normal' | 'jugular_dilated' | 'femoral_reduced' | 'NONE'`) — **Dev 6**

## Events (`document.addEventListener`)

`hemospace:tab` `{tab}` · `hemospace:gravity` `{gravityProfile}` · `hemospace:preset` `{code, ultrasoundPreset}` · `hemospace:zone` `{zoneKey}`

## Payload sent (`POST /api/v1/readings`) — camelCase, same as the `ReadingRequest` record

```json
{ "astronautId": "AST-04", "gravityProfile": "0G_ORBIT",
  "armSystolicMmhg": 118, "armDiastolicMmhg": 76, "ankleSystolicMmhg": 112,
  "heartRateBpm": 68, "calfCircumferenceCm": 0.0,
  "ppgCapillaryRefillSec": 1.5, "ultrasoundPreset": "NONE" }
```

The **response** is snake_case (`astronaut_id`, `computed_metrics`, `zones`…). Dev 2: use `@JsonProperty` on the response records (or a separate DTO) so the camelCase input does not break.

## Classes and colors

`.st-blue` `#2563EB` · `.st-green` `#16A34A` · `.st-amber` `#D97706` · `.st-red` `#DC2626`. Mapping: `YELLOW` → `st-amber`.
In the SVG (Dev 3): `<g id="zone-head" class="zone st-green">` already inherits the color via CSS.
