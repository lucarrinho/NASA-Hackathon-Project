package com.hemospace.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hemospace.model.*;
import com.hemospace.model.AstronautStateResponse.ComputedMetrics;
import com.hemospace.model.AstronautStateResponse.HistoryPoint;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class HemodynamicService {

    public static final Set<String> GRAVITY_PROFILES =
            Set.of("0G_ORBIT", "1_6G_MOON", "3_8G_MARS", "1G_EARTH");
    public static final Set<String> ULTRASOUND_PRESETS =
            Set.of("NORMAL", "DILATED", "REDUCED");

    // ===== PROVISIONAL RULES (NOT DEFINED IN THE SPECIFICATION) =====
    // Must be approved by technical leadership and moved to clinical_rules.json.
    /** Scenario C: orthostatic alert = MARS/EARTH profile + HR >= X + PP < Y. */
    static final int ORTHOSTATIC_HR_MIN_BPM = 95;
    static final double ORTHOSTATIC_PP_MAX_MMHG = 30;
    // ================================================================

        // ===== THRESHOLDS (mirrored in clinical_rules.json) =====
    /** ABI <= 0.90: abnormal (AHA/ACC). */
    static final double ABI_BLUE_MAX_INCLUSIVE = 0.90;
    /** ABI > 1.40: non-compressible arteries (AHA/ACC). Team decision: 1.40 (not 1.30). */
    static final double ABI_GREEN_MAX_INCLUSIVE = 1.40;
    /** Pulse pressure: red if < 25 mmHg OR < 25% of systolic ("narrow"). */
    static final double PP_RED_BELOW_MMHG = 25;
    static final double PP_RED_BELOW_FRACTION = 0.25;
    /** PROVISIONAL: slow capillary refill (s). Confirm with health reviewer. */
    static final double CAPILLARY_REFILL_MAX_SEC = 2.0;

    private record History(int missionDay, List<HistoryPoint> points) {}

    private final Map<String, History> histories = new ConcurrentHashMap<>();
    private final Map<String, AstronautStateResponse> lastState = new ConcurrentHashMap<>();

    public HemodynamicService(ObjectMapper mapper) {
        loadHistory(mapper);
    }

    private void loadHistory(ObjectMapper mapper) {
        try (InputStream in = new ClassPathResource("astronaut_history.json").getInputStream()) {
            JsonNode root = mapper.readTree(in);
            List<HistoryPoint> points = mapper.convertValue(
                    root.get("history"), new TypeReference<List<HistoryPoint>>() {});
            histories.put(root.get("astronaut_id").asText(),
                    new History(root.get("mission_day").asInt(), points));
        } catch (IOException e) {
            throw new IllegalStateException("Failed to load astronaut_history.json", e);
        }
    }

    // ---------------------------------------------------------------- calculations

    public double calculateMAP(double systolic, double diastolic) {
        return (systolic + 2 * diastolic) / 3.0;
    }

    public double calculateABI(double ankle, double arm) {
        if (arm <= 0) throw new IllegalArgumentException("Arm pressure must be greater than zero.");
        return ankle / arm;
    }

    public double calculatePulsePressure(double systolic, double diastolic) {
        return systolic - diastolic;
    }

    public String classifyMAP(double map) {
        if (map < 70) return "BLUE";
        if (map <= 100) return "GREEN";
        return "YELLOW"; // TODO: YELLOW vs RED rule above 100 not yet defined
    }

    public String classifyABI(double abi) {
        if (abi <= ABI_BLUE_MAX_INCLUSIVE) return "BLUE";
        if (abi <= ABI_GREEN_MAX_INCLUSIVE) return "GREEN";
        return "YELLOW";
    }

    public String classifyPulsePressure(double pp) {
        if (pp < 25) return "RED";
        if (pp <= 60) return "GREEN";
        return "YELLOW";
    }

    /** Absolute OR proportional (PP < 25% of systolic). */
    public String classifyPulsePressure(double pp, double systolic) {
        if (pp < PP_RED_BELOW_MMHG || (systolic > 0 && pp / systolic < PP_RED_BELOW_FRACTION)) return "RED";
        if (pp <= 60) return "GREEN";
        return "YELLOW";
    }

    // ------------------------------------------------------------- orchestration

    public AstronautStateResponse getState(String astronautId) {
        History h = requireHistory(astronautId);
        return lastState.computeIfAbsent(astronautId, id -> evaluate(defaultReading(id), h));
    }

    public AstronautStateResponse processReading(ReadingRequest req) {
        validate(req);
        History h = requireHistory(req.astronautId());
        AstronautStateResponse resp = evaluate(req, h);
        lastState.put(req.astronautId(), resp);
        return resp;
    }

    public AstronautStateResponse applyDemoPreset(String code) {
        ReadingRequest req = switch (code == null ? "" : code.toUpperCase()) {
            case "A" -> new ReadingRequest("AST-04", "0G_ORBIT", 118, 76, 112, 68, 35.0, 2.0, "NORMAL");
            case "B" -> new ReadingRequest("AST-04", "0G_ORBIT", 138, 88, 108, 84, 35.0, 2.0, "DILATED");
            // C: calf variation (-2.4 cm) does not fit in calfCircumferenceCm; value below is a placeholder
            case "C" -> new ReadingRequest("AST-04", "3_8G_MARS", 96, 68, 84, 98, 35.0, 2.0, "NORMAL");
            default -> throw new ResourceNotFoundException("Nonexistent preset: " + code);
        };
        return processReading(req);
    }

    private ReadingRequest defaultReading(String id) {
        // Initial state (before any reading): ABI 0.82 per the specification example
        return new ReadingRequest(id, "0G_ORBIT", 120, 80, 98.4, 74, 35.0, 2.0, "NORMAL");
    }

    private AstronautStateResponse evaluate(ReadingRequest req, History h) {
        double map = calculateMAP(req.armSystolicMmhg(), req.armDiastolicMmhg());
        double abi = calculateABI(req.ankleSystolicMmhg(), req.armSystolicMmhg());
        double pp = calculatePulsePressure(req.armSystolicMmhg(), req.armDiastolicMmhg());

        double abiR = round2(abi); // classify using the same value shown on screen (e.g., 0.90 -> blue)
        Map<String, ZoneStatusDTO> zones = new LinkedHashMap<>();
        zones.put("head_neck", headNeck(abiR, req.ultrasoundPreset()));
        zones.put("thorax_heart", thorax(map, pp, req));
        zones.put("upper_limbs", upperLimbs(map, req.ppgCapillaryRefillSec()));
        zones.put("lower_limbs", lowerLimbs(abiR));

        return new AstronautStateResponse(
                req.astronautId(), h.missionDay(), req.gravityProfile(),
                new ComputedMetrics(round2(map), round2(abi), round2(pp)),
                zones, h.points());
    }

    // ------------------------------------------------------------------ zones

    /**
     * Jugular ultrasound is the main marker. Low ABI alone only downgrades green -> yellow.
     * Red = dilated jugular CONFIRMED by ABI <= 0.90 (keeps Scenario B from the specification).
     */
    private ZoneStatusDTO headNeck(double abi, String ultrasound) {
        boolean jugularDilated = "DILATED".equals(ultrasound);
        boolean lowAbi = classifyABI(abi).equals("BLUE");
        if (jugularDilated && lowAbi)
            return new ZoneStatusDTO("RED", "Severe Cephalic Congestion (SANS risk)",
                    "Apply thigh constriction cuffs (Braslet), elevate the torso at rest and perform an eye exam.");
        if (jugularDilated)
            return new ZoneStatusDTO("YELLOW", "Mild Cephalic Congestion",
                    "Start 20 min LBNP and monitor vision.");
        if (lowAbi)
            return new ZoneStatusDTO("YELLOW", "Reduced Distal Perfusion (watch for cephalic congestion)",
                    "Confirm with jugular ultrasound and monitor vision.");
        return new ZoneStatusDTO("GREEN", "No Cephalic Congestion", "No intervention required.");
    }

    private ZoneStatusDTO thorax(double map, double pp, ReadingRequest req) {
        String ppClass = classifyPulsePressure(pp, req.armSystolicMmhg());
        if (ppClass.equals("RED"))
            return new ZoneStatusDTO("RED", "Critical Pulse Pressure (hypovolemia)",
                    "Urgent fluid replacement protocol and suspension of extravehicular activity (EVA).");
        // DEMO HEURISTIC (not a validated clinical rule): see orthostaticRisk()
        if (orthostaticRisk(pp, req))
            return new ZoneStatusDTO("YELLOW", "Orthostatic Intolerance Risk (demo alert)",
                    "Start pre-hydration and block immediate exit from the module.");
        return switch (classifyMAP(map)) {
            case "BLUE" -> new ZoneStatusDTO("BLUE", "Low MAP", "Isotonic hydration.");
            case "YELLOW" -> new ZoneStatusDTO("YELLOW", "High MAP", "Rest and sodium reduction.");
            default -> ppClass.equals("YELLOW")
                    ? new ZoneStatusDTO("YELLOW", "High Pulse Pressure", "Monitor condition.")
                    : new ZoneStatusDTO("GREEN", "Stable Cardiac Output", "Maintain standard aerobic routine.");
        };
    }

    private boolean orthostaticRisk(double pp, ReadingRequest req) {
        boolean transition = req.gravityProfile().equals("3_8G_MARS") || req.gravityProfile().equals("1G_EARTH");
        return transition && req.heartRateBpm() >= ORTHOSTATIC_HR_MIN_BPM && pp < ORTHOSTATIC_PP_MAX_MMHG;
    }

    /** Capillary refill (finger PPG) can only downgrade green -> yellow; never produces red. */
    private ZoneStatusDTO upperLimbs(double map, double refillSec) {
        ZoneStatusDTO base = switch (classifyMAP(map)) {
            case "BLUE" -> new ZoneStatusDTO("BLUE", "Low Systemic Pressure", "Isotonic hydration.");
            case "YELLOW" -> new ZoneStatusDTO("YELLOW", "High Systemic Pressure", "Rest and sodium reduction.");
            default -> new ZoneStatusDTO("GREEN", "Normal Systemic Perfusion", "No intervention required.");
        };
        if (base.status().equals("GREEN") && refillSec > CAPILLARY_REFILL_MAX_SEC)
            return new ZoneStatusDTO("YELLOW", "Reduced Peripheral Perfusion (slow capillary refill)",
                    "Repeat the measurement after rest and reassess.");
        return base;
    }

    private ZoneStatusDTO lowerLimbs(double abi) {
        return switch (classifyABI(abi)) {
            case "BLUE" -> new ZoneStatusDTO("BLUE", "Distal Volume Deficit",
                    "Run pre-hydration protocol.");
            case "YELLOW" -> new ZoneStatusDTO("YELLOW", "High ABI",
                    "Activate negative-pressure trousers (LBNP) and lower-limb resistance exercise.");
            default -> new ZoneStatusDTO("GREEN", "Normal Distal Perfusion", "No intervention required.");
        };
    }

    // --------------------------------------------------------------- ultrasound

    public UltrasoundResponse classifyUltrasound(UltrasoundRequest req) {
        if (req.astronautId() == null || req.astronautId().isBlank())
            throw new IllegalArgumentException("astronautId is required.");
        requireHistory(req.astronautId());
        String region = req.region() == null ? "" : req.region().toUpperCase();
        String preset = req.ultrasoundPreset() == null ? "" : req.ultrasoundPreset().toUpperCase();
        if (!ULTRASOUND_PRESETS.contains(preset))
            throw new IllegalArgumentException("Unknown ultrasound preset: " + req.ultrasoundPreset());

        return switch (region + ":" + preset) {
            case "JUGULAR:NORMAL" -> new UltrasoundResponse("head_neck", preset, "GREEN",
                    "Normal jugular", "Maintain monitoring");
            case "JUGULAR:DILATED" -> new UltrasoundResponse("head_neck", preset, "YELLOW",
                    "Jugular change detected", "Reassess cephalic congestion");
            case "FEMORAL:NORMAL" -> new UltrasoundResponse("lower_limbs", preset, "GREEN",
                    "Normal femoral flow", "Maintain monitoring");
            case "FEMORAL:REDUCED" -> new UltrasoundResponse("lower_limbs", preset, "BLUE",
                    "Reduced femoral flow", "Reassess distal perfusion");
            default -> throw new IllegalArgumentException(
                    "Invalid region/preset combination: " + region + "/" + preset);
        };
    }

    // -------------------------------------------------------------- validation

    void validate(ReadingRequest r) {
        if (r == null) throw new IllegalArgumentException("Request body missing.");
        if (r.astronautId() == null || r.astronautId().isBlank())
            throw new IllegalArgumentException("astronautId is required.");
        if (r.gravityProfile() == null || !GRAVITY_PROFILES.contains(r.gravityProfile()))
            throw new IllegalArgumentException("Invalid gravityProfile.");
        if (!positive(r.armSystolicMmhg()) || !positive(r.ankleSystolicMmhg()) || !positive(r.armDiastolicMmhg()))
            throw new IllegalArgumentException("Pressures must be positive and finite.");
        if (r.armSystolicMmhg() <= r.armDiastolicMmhg())
            throw new IllegalArgumentException("Systolic pressure must be greater than diastolic pressure.");
        if (r.heartRateBpm() <= 0)
            throw new IllegalArgumentException("Heart rate must be positive.");
        if (!nonNegative(r.calfCircumferenceCm()) || !nonNegative(r.ppgCapillaryRefillSec()))
            throw new IllegalArgumentException("Circumference and PPG must be non-negative and finite.");
        if (r.ultrasoundPreset() == null || !ULTRASOUND_PRESETS.contains(r.ultrasoundPreset()))
            throw new IllegalArgumentException("Unknown ultrasoundPreset.");
    }

    private boolean positive(double v) { return Double.isFinite(v) && v > 0; }
    private boolean nonNegative(double v) { return Double.isFinite(v) && v >= 0; }

    private History requireHistory(String id) {
        History h = id == null ? null : histories.get(id);
        if (h == null) throw new ResourceNotFoundException("Astronaut not found: " + id);
        return h;
    }

    private static double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
