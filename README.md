# HemoSpace — Regional Hemodynamic Monitor for Astronauts

> An interactive health self-assessment tool for crews on long-duration space missions. Built for the NASA Space Apps hackathon challenge *"Create Health Monitoring Software for Astronauts on Space Missions."*

> **Educational prototype.** Thresholds are simplifications inspired by public spaceflight-physiology research. HemoSpace is **not** a medical device and does not replace evaluation by a flight surgeon. See [Limitations](#limitations-and-honest-caveats).

---

## The problem

On missions to the Moon and Mars, help from Earth is minutes to hours away, so astronauts must be able to assess their own health. Microgravity shifts body fluids toward the head, and NASA's Human Research Program identifies this as part of the broader hazards of spaceflight (altered gravity fields, isolation, distance from Earth, radiation and hostile closed environments). The consequences include cephalic congestion, a suspected contributor to **Spaceflight-Associated Neuro-ocular Syndrome (SANS)**, and **orthostatic intolerance** when returning to a gravity field.

## What HemoSpace does

HemoSpace turns a few measurements an astronaut can take on board into a **regional picture of blood and fluid distribution**:

1. The astronaut enters a quick cuff reading, runs an optical (camera) scan, and/or loads a vascular ultrasound image.
2. The backend computes hemodynamic metrics (MAP, ABI, pulse pressure) and classifies four body regions.
3. A clickable **body map** colors each region by status, and a side panel explains *why* the region matters in flight, shows a 7-day trend, and lists recommended actions and countermeasures.
4. The gravity environment (0g orbit, 1/6g Moon, 3/8g Mars, 1g Earth) changes the map's flow arrows and some of the rules.

### Features

- **Interactive body map** with four clickable zones: Head & Neck, Thorax & Heart, Upper Limbs, Lower Limbs. Each zone is keyboard-accessible.
- **Four status levels**: 🔵 blue (low), 🟢 green (normal), 🟡 yellow (attention), 🔴 red (act now).
- **Gravity selector** (0g / 1/6g / 3/8g / 1g) with fluid-flow arrows on the body map.
- **Three input modes**
  - *Quick Measurement*: arm SBP/DBP, ankle SBP, heart rate, calf variation.
  - *Optical Scanner*: webcam photoplethysmography (PPG) to estimate heart rate, plus a capillary refill timer. A simulated signal runs through the same pipeline as a fallback.
  - *Ultrasound Analysis*: sample or uploaded jugular/femoral images with an illustrative vessel overlay.
- **Clinical panel** per zone: NASA hazard tag, 7-day trend chart (Chart.js), an explanation of why the region is monitored, and countermeasures.
- **Demo scenarios A/B/C** for presentations.
- **Offline mode**: if the Java backend is unreachable, the frontend falls back to an equivalent local calculation engine and shows an "Offline mode" indicator.

## Quick start

### Requirements

- Java 17+ and Maven 3.9+ (backend)
- Any modern browser (frontend)
- Node.js 20+ (only to run the frontend tests)

### 1. Start the backend (port 8080)

```bash
cd hemospace-mvp/backend-java
mvn spring-boot:run
```

### 2. Open the frontend

The frontend is plain HTML/CSS/JS with no build step. For the camera scanner to work, serve it from `localhost` (browsers restrict camera access on `file://` pages in many configurations):

```bash
cd hemospace-mvp/frontend
python3 -m http.server 5500
# then open http://localhost:5500
```

You can also open `hemospace-mvp/frontend/index.html` directly, or the root `index.html`, which redirects there. Chart.js is loaded from a CDN, so the first load needs an internet connection.

### 3. Try a demo scenario

Click **Scenario A**, **B** or **C** in the top bar, then select zones on the body map.

| Scenario | Setup | Expected result |
|---|---|---|
| **A: Healthy baseline** | 0g orbit, 118/76 mmHg, ankle 112, HR 68, normal jugular | All four zones green |
| **B: Cephalic congestion** | 0g orbit, 138/88 mmHg, ankle 108, HR 84, dilated jugular | Head & Neck **red** (SANS risk), Thorax and Upper Limbs yellow (high MAP), Lower Limbs blue (low ABI) |
| **C: Orthostatic risk on Mars** | 3/8g Mars, 96/68 mmHg, ankle 84, HR 98, calf −2.4 cm | Thorax yellow (orthostatic alert, demo heuristic), Head & Neck yellow, Lower Limbs blue |

## How it works

### Metrics

| Metric | Formula | Why it matters |
|---|---|---|
| **MAP** (mean arterial pressure) | `(SBP + 2·DBP) / 3` | Overall organ perfusion pressure |
| **ABI** (ankle-brachial index) | `ankle SBP / arm SBP` | Used here as a *distal perfusion signal* (project adaptation) |
| **Pulse pressure** | `SBP − DBP` | Low values suggest reduced stroke volume or hypovolemia |

### Classification rules

| Indicator | 🔵 Blue | 🟢 Green | 🟡 Yellow | 🔴 Red |
|---|---|---|---|---|
| MAP (mmHg) | < 70 | 70–100 | > 100 | not defined |
| ABI | ≤ 0.90 | 0.91–1.40 | > 1.40 | not defined |
| Pulse pressure | n/a | 25–60 mmHg | > 60 mmHg | < 25 mmHg **or** < 25% of systolic |
| Capillary refill | n/a | ≤ 2.0 s | > 2.0 s (can only downgrade green) | never |

### Zone logic

| Zone | Main inputs | Behavior |
|---|---|---|
| **Head & Neck** | Jugular ultrasound, ABI | Dilated jugular + ABI ≤ 0.90 → red; dilated jugular alone → yellow; low ABI alone → yellow |
| **Thorax & Heart** | Pulse pressure, MAP, HR, gravity | Narrow pulse pressure → red; orthostatic alert (Mars/Earth + HR ≥ 95 + PP < 30) → yellow; otherwise MAP-based |
| **Upper Limbs** | MAP, capillary refill | MAP-based; slow refill downgrades green to yellow |
| **Lower Limbs** | ABI | Blue / green / yellow by ABI band |

The thresholds are documented in [`clinical_rules.json`](hemospace-mvp/backend-java/src/main/resources/clinical_rules.json). The same constants live in `HemodynamicService.java` and in the `LocalEngine` inside `frontend/js/api.js`. **Any rule change must be made in all three places.**

## Architecture

```
┌────────────────────────── Browser (vanilla JS) ──────────────────────────┐
│  inputs.js ─┐                                                            │
│  ultrasound.js ─┼─► app.js (orchestrator, HemoState) ─► api.js           │
│                 │                │                         │            │
│                 │         bodymap.js (SVG map)       POST /api/v1/...     │
│                 │         panel.js (clinical panel)  or LocalEngine       │
└─────────────────┴────────────────┴─────────────────────────┬────────────┘
                                                             │ JSON
                                        ┌────────────────────▼───────────┐
                                        │  Spring Boot 3.5 / Java 17     │
                                        │  HemodynamicController         │
                                        │  HemodynamicService (rules)    │
                                        │  clinical_rules.json           │
                                        │  astronaut_history.json        │
                                        └────────────────────────────────┘
```

### REST API (`http://localhost:8080/api/v1`)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/readings` | Submit a reading and receive the computed state |
| `GET` | `/astronauts/{id}/state` | Latest state for an astronaut |
| `POST` | `/ultrasound/classify` | Classify an ultrasound exam type (jugular or femoral) |
| `POST` | `/demo/preset/{code}` | Apply demo scenario `A`, `B` or `C` |

Example request:

```bash
curl -X POST http://localhost:8080/api/v1/readings \
  -H "Content-Type: application/json" \
  -d '{
        "astronautId": "AST-04",
        "gravityProfile": "0G_ORBIT",
        "armSystolicMmhg": 138, "armDiastolicMmhg": 88,
        "ankleSystolicMmhg": 108, "heartRateBpm": 84,
        "calfCircumferenceCm": 35.0,
        "ppgCapillaryRefillSec": 1.5,
        "ultrasoundPreset": "DILATED"
      }'
```

Requests use camelCase. Responses use snake_case (`astronaut_id`, `computed_metrics`, `zones`, `history`). Valid gravity profiles are `0G_ORBIT`, `1_6G_MOON`, `3_8G_MARS` and `1G_EARTH`. Invalid input returns a structured error via `GlobalExceptionHandler`.

## Project structure

```
NASA-Hackathon-Project/
├── index.html                  # redirects to the frontend
├── docs/
│   ├── PESQUISA_SAUDE.md       # health research review of the MVP rules (Portuguese)
│   └── INTEGRATION.md          # module contract used during development
└── hemospace-mvp/
    ├── backend-java/           # Spring Boot API
    │   └── src/main/java/com/hemospace/{controller,service,model,config}
    └── frontend/
        ├── index.html
        ├── css/styles.css
        ├── js/                 # api, app, bodymap, inputs, panel, ultrasound
        ├── assets/             # favicon, sample ultrasound SVGs
        └── tests/              # jsdom tests (node --test)
```

## Running the tests

```bash
# Backend
cd hemospace-mvp/backend-java
mvn test

# Frontend
cd hemospace-mvp/frontend/tests
npm install
npm test
```

## Science background

The design decisions are based on NASA's Human Research Program and public literature on fluid shifts, SANS, lower body negative pressure (LBNP) and post-flight orthostatic intolerance. [`docs/PESQUISA_SAUDE.md`](docs/PESQUISA_SAUDE.md) records which MVP rules are supported by sources, which are partial, and which are project heuristics, along with the list of sources consulted.

Key points reflected in the app:

- In microgravity, fluid shifts toward the head. Jugular ultrasound is the main marker for the Head & Neck zone.
- LBNP and thigh cuffs appear as countermeasures **under study**, not as proven treatments for SANS.
- Orthostatic intolerance is a documented problem after returning to a gravity field. The in-app alert is a demo heuristic and is labeled as such.

## Limitations and honest caveats

- **Not clinically validated.** Thresholds are simplified. Several rules are marked *provisional* in `clinical_rules.json` (capillary refill, orthostatic alert, head-and-neck combination logic).
- **ABI is borrowed.** It is validated for peripheral artery disease, not for fluid-shift assessment. Here it is a project adaptation.
- **Ultrasound images are not analyzed.** Classification comes from the selected sample (or the exam type chosen for an uploaded image). The vessel overlay is illustrative.
- **Webcam PPG is an educational simulation** with no clinical validity.
- **Calf circumference is validated but informational**; no rule uses it yet.
- **Moon and Mars behavior is illustrative.** No fluid-distribution data was found for 1/6g and 3/8g, so the visual rules are hypotheses.
- **Data is a single sample astronaut** (`AST-04`, day 42) with a static 7-day history. State is held in memory and lost on restart.
- **MAP red level is undefined**: values above 100 mmHg stay yellow.

## Roadmap ideas

- Real image analysis for jugular and femoral ultrasound (vessel segmentation)
- Review of all thresholds by a clinician or space-medicine mentor
- Additional indicators from the challenge brief: blood glucose, body temperature, sleep and mood for the behavioral-health hazard
- Persistent storage and multi-crew support
- Downlink summary for flight surgeons on the ground, with alert escalation rules

## Tech stack

Java 17 · Spring Boot 3.5 · Maven · vanilla JavaScript · SVG · Chart.js · JUnit/Spring Test · Node test runner + jsdom

## Team and license

*Add team members, hackathon name and license here.*
