/* HemoSpace — DEV3: mapa corporal. Só apresenta o estado recebido; não calcula nada clínico. */
(() => {
  const ZONES = {
    head_neck: "zone-head",
    thorax_heart: "zone-thorax",
    upper_limbs: "zone-arms",
    lower_limbs: "zone-legs"
  };
  const STATUS_CLASSES = ["st-blue", "st-green", "st-amber", "st-red"];
  const STATUS_TO_CLASS = {
    BLUE: "st-blue", GREEN: "st-green", YELLOW: "st-amber", RED: "st-red"
  };

  function paintZone(zoneKey, zoneData) {
    const el = document.getElementById(ZONES[zoneKey]);
    if (!el) return;
    el.classList.remove(...STATUS_CLASSES);
    const status = String(zoneData?.status || "").toUpperCase();
    const cls = STATUS_TO_CLASS[status];
    if (cls) {
      el.classList.add(cls);
      el.dataset.status = status;
    } else {
      el.dataset.status = "UNKNOWN";
      console.warn(`BodyMap: status ausente/desconhecido em "${zoneKey}":`, zoneData?.status);
    }
    if (zoneData?.label) el.setAttribute("aria-label", zoneData.label);
  }

  // Atributo `hidden` não é confiável em elementos SVG: usa-se display.
  function setShown(el, shown) {
    if (!el) return;
    if (shown) el.removeAttribute("display");
    else el.setAttribute("display", "none");
  }

  // 0G -> seta cefálica; 1G -> seta distal; Lua/Marte: sem seta até a equipe definir a regra.
  function updateFlowDirection(gravityProfile) {
    setShown(document.getElementById("flow-up"), gravityProfile === "0G_ORBIT");
    setShown(document.getElementById("flow-down"), gravityProfile === "1G_EARTH");
  }

  // Origem do bpm ainda PENDENTE com Dev1/Dev2. Só controla velocidade visual (60 / bpm s).
  function setHeartRate(heartRateBpm) {
    const heart = document.querySelector("#zone-thorax .heart-pulse");
    if (!heart) return;
    const bpm = Number(heartRateBpm);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      heart.classList.remove("is-beating");
      heart.style.removeProperty("--beat-duration");
      return;
    }
    heart.style.setProperty("--beat-duration", `${60 / bpm}s`);
    heart.classList.add("is-beating");
  }

  function setSelected(zoneKey) {
    Object.entries(ZONES).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = key === zoneKey;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-pressed", String(on));
    });
  }

  // render(zones, gravityProfile, options?)  options.heartRateBpm é opcional (ver pendência)
  function render(zonesData, gravityProfile, options) {
    if (!zonesData || typeof zonesData !== "object") {
      console.warn("BodyMap: dados de zonas ausentes ou inválidos.");
      return;
    }
    Object.keys(ZONES).forEach((key) => paintZone(key, zonesData[key] || {}));
    updateFlowDirection(gravityProfile);
    if (options && "heartRateBpm" in options) setHeartRate(options.heartRateBpm);
  }

  function selectFromMap(zoneKey) {
    setSelected(zoneKey);
    if (typeof window.selectZone === "function") window.selectZone(zoneKey);
    else console.warn("BodyMap: window.selectZone ainda não está disponível.");
  }

  function bindZoneEvents() {
    document.querySelectorAll("#body-map [data-zone]").forEach((el) => {
      if (el.dataset.bodymapBound === "true") return;
      el.dataset.bodymapBound = "true";
      const key = el.dataset.zone;
      el.addEventListener("click", () => selectFromMap(key));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectFromMap(key);
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindZoneEvents);
  } else {
    bindZoneEvents();
  }

  window.BodyMap = { render, setHeartRate, setSelected };
})();
