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

    // ===== REGRAS PROVISÓRIAS (NÃO DEFINIDAS NA ESPECIFICAÇÃO) =====
    // Precisam ser aprovadas pela liderança técnica e movidas p/ clinical_rules.json.
    /** Cenário C: alerta ortostático = perfil MARS/EARTH + FC >= X + PP < Y. */
    static final int ORTHOSTATIC_HR_MIN_BPM = 95;
    static final double ORTHOSTATIC_PP_MAX_MMHG = 30;
    // ================================================================

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
            throw new IllegalStateException("Falha ao carregar astronaut_history.json", e);
        }
    }

    // ---------------------------------------------------------------- cálculos

    public double calculateMAP(double systolic, double diastolic) {
        return (systolic + 2 * diastolic) / 3.0;
    }

    public double calculateABI(double ankle, double arm) {
        if (arm <= 0) throw new IllegalArgumentException("Pressão do braço deve ser maior que zero.");
        return ankle / arm;
    }

    public double calculatePulsePressure(double systolic, double diastolic) {
        return systolic - diastolic;
    }

    public String classifyMAP(double map) {
        if (map < 70) return "BLUE";
        if (map <= 100) return "GREEN";
        return "YELLOW"; // TODO: regra YELLOW x RED acima de 100 ainda não definida
    }

    public String classifyABI(double abi) {
        if (abi < 0.90) return "BLUE";
        if (abi <= 1.30) return "GREEN";
        return "YELLOW";
    }

    public String classifyPulsePressure(double pp) {
        if (pp < 25) return "RED";
        if (pp <= 60) return "GREEN";
        return "YELLOW";
    }

    // ------------------------------------------------------------- orquestração

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
            // C: variação de panturrilha (-2,4 cm) não cabe em calfCircumferenceCm; valor abaixo é placeholder
            case "C" -> new ReadingRequest("AST-04", "3_8G_MARS", 96, 68, 84, 98, 35.0, 2.0, "NORMAL");
            default -> throw new ResourceNotFoundException("Preset inexistente: " + code);
        };
        return processReading(req);
    }

    private ReadingRequest defaultReading(String id) {
        // Estado inicial (antes de qualquer leitura): ITB 0,82 conforme exemplo da especificação
        return new ReadingRequest(id, "0G_ORBIT", 120, 80, 98.4, 74, 35.0, 2.0, "NORMAL");
    }

    private AstronautStateResponse evaluate(ReadingRequest req, History h) {
        double map = calculateMAP(req.armSystolicMmhg(), req.armDiastolicMmhg());
        double abi = calculateABI(req.ankleSystolicMmhg(), req.armSystolicMmhg());
        double pp = calculatePulsePressure(req.armSystolicMmhg(), req.armDiastolicMmhg());

        Map<String, ZoneStatusDTO> zones = new LinkedHashMap<>();
        zones.put("head_neck", headNeck(abi, req.ultrasoundPreset()));
        zones.put("thorax_heart", thorax(map, pp, req));
        zones.put("upper_limbs", upperLimbs(map));
        zones.put("lower_limbs", lowerLimbs(abi));

        return new AstronautStateResponse(
                req.astronautId(), h.missionDay(), req.gravityProfile(),
                new ComputedMetrics(round2(map), round2(abi), round2(pp)),
                zones, h.points());
    }

    // ------------------------------------------------------------------ zonas

    /** PROVISÓRIO: ITB<0,90 e jugular dilatada => RED; só um dos dois => YELLOW. PPG ainda fora da regra. */
    private ZoneStatusDTO headNeck(double abi, String ultrasound) {
        boolean lowAbi = abi < 0.90;
        boolean dilated = "DILATED".equals(ultrasound);
        if (lowAbi && dilated)
            return new ZoneStatusDTO("RED", "Congestão Cefálica Severa (risco SANS)",
                    "Aplicar cintas de contenção nas coxas (Braslet), elevar tronco no repouso e realizar exame ocular.");
        if (lowAbi || dilated)
            return new ZoneStatusDTO("YELLOW", "Congestão Cefálica Leve",
                    "Iniciar LBNP 20 min e monitorar visão.");
        return new ZoneStatusDTO("GREEN", "Sem Congestão Cefálica", "Nenhuma intervenção necessária.");
    }

    private ZoneStatusDTO thorax(double map, double pp, ReadingRequest req) {
        if (classifyPulsePressure(pp).equals("RED"))
            return new ZoneStatusDTO("RED", "Pressão de Pulso Crítica (hipovolemia)",
                    "Protocolo urgente de reposição volêmica e suspensão de atividade extraveicular (EVA).");
        if (orthostaticRisk(pp, req))
            return new ZoneStatusDTO("YELLOW", "Risco de Intolerância Ortostática",
                    "Iniciar pré-hidratação e bloquear saída imediata do módulo.");
        return switch (classifyMAP(map)) {
            case "BLUE" -> new ZoneStatusDTO("BLUE", "PAM Baixa", "Hidratação isotônica.");
            case "YELLOW" -> new ZoneStatusDTO("YELLOW", "PAM Elevada", "Repouso e redução de sódio.");
            default -> classifyPulsePressure(pp).equals("YELLOW")
                    ? new ZoneStatusDTO("YELLOW", "Pressão de Pulso Elevada", "Monitorar condição.")
                    : new ZoneStatusDTO("GREEN", "Débito Cardíaco Estável", "Manter rotina aeróbica padrão.");
        };
    }

    private boolean orthostaticRisk(double pp, ReadingRequest req) {
        boolean transition = req.gravityProfile().equals("3_8G_MARS") || req.gravityProfile().equals("1G_EARTH");
        return transition && req.heartRateBpm() >= ORTHOSTATIC_HR_MIN_BPM && pp < ORTHOSTATIC_PP_MAX_MMHG;
    }

    private ZoneStatusDTO upperLimbs(double map) {
        return switch (classifyMAP(map)) {
            case "BLUE" -> new ZoneStatusDTO("BLUE", "Pressão Sistêmica Baixa", "Hidratação isotônica.");
            case "YELLOW" -> new ZoneStatusDTO("YELLOW", "Pressão Sistêmica Elevada", "Repouso e redução de sódio.");
            default -> new ZoneStatusDTO("GREEN", "Perfusão Sistêmica Normal", "Nenhuma intervenção necessária.");
        };
    }

    private ZoneStatusDTO lowerLimbs(double abi) {
        return switch (classifyABI(abi)) {
            case "BLUE" -> new ZoneStatusDTO("BLUE", "Déficit de Volume Distal",
                    "Executar protocolo de pré-hidratação.");
            case "YELLOW" -> new ZoneStatusDTO("YELLOW", "ITB Elevado",
                    "Ativar calça de pressão negativa (LBNP) e exercício resistido de membros inferiores.");
            default -> new ZoneStatusDTO("GREEN", "Perfusão Distal Normal", "Nenhuma intervenção necessária.");
        };
    }

    // --------------------------------------------------------------- ultrassom

    public UltrasoundResponse classifyUltrasound(UltrasoundRequest req) {
        if (req.astronautId() == null || req.astronautId().isBlank())
            throw new IllegalArgumentException("astronautId é obrigatório.");
        requireHistory(req.astronautId());
        String region = req.region() == null ? "" : req.region().toUpperCase();
        String preset = req.ultrasoundPreset() == null ? "" : req.ultrasoundPreset().toUpperCase();
        if (!ULTRASOUND_PRESETS.contains(preset))
            throw new IllegalArgumentException("Preset de ultrassom desconhecido: " + req.ultrasoundPreset());

        return switch (region + ":" + preset) {
            case "JUGULAR:NORMAL" -> new UltrasoundResponse("head_neck", preset, "GREEN",
                    "Jugular normal", "Manter monitoramento");
            case "JUGULAR:DILATED" -> new UltrasoundResponse("head_neck", preset, "YELLOW",
                    "Alteração jugular detectada", "Reavaliar congestão cefálica");
            case "FEMORAL:NORMAL" -> new UltrasoundResponse("lower_limbs", preset, "GREEN",
                    "Fluxo femoral normal", "Manter monitoramento");
            case "FEMORAL:REDUCED" -> new UltrasoundResponse("lower_limbs", preset, "BLUE",
                    "Fluxo femoral reduzido", "Reavaliar perfusão distal");
            default -> throw new IllegalArgumentException(
                    "Combinação inválida de região/preset: " + region + "/" + preset);
        };
    }

    // -------------------------------------------------------------- validação

    void validate(ReadingRequest r) {
        if (r == null) throw new IllegalArgumentException("Corpo da requisição ausente.");
        if (r.astronautId() == null || r.astronautId().isBlank())
            throw new IllegalArgumentException("astronautId é obrigatório.");
        if (r.gravityProfile() == null || !GRAVITY_PROFILES.contains(r.gravityProfile()))
            throw new IllegalArgumentException("gravityProfile inválido.");
        if (!positive(r.armSystolicMmhg()) || !positive(r.ankleSystolicMmhg()) || !positive(r.armDiastolicMmhg()))
            throw new IllegalArgumentException("Pressões devem ser positivas e finitas.");
        if (r.armSystolicMmhg() <= r.armDiastolicMmhg())
            throw new IllegalArgumentException("Pressão sistólica deve ser maior que pressão diastólica.");
        if (r.heartRateBpm() <= 0)
            throw new IllegalArgumentException("Frequência cardíaca deve ser positiva.");
        if (!nonNegative(r.calfCircumferenceCm()) || !nonNegative(r.ppgCapillaryRefillSec()))
            throw new IllegalArgumentException("Circunferência e PPG devem ser não negativos e finitos.");
        if (r.ultrasoundPreset() == null || !ULTRASOUND_PRESETS.contains(r.ultrasoundPreset()))
            throw new IllegalArgumentException("ultrasoundPreset desconhecido.");
    }

    private boolean positive(double v) { return Double.isFinite(v) && v > 0; }
    private boolean nonNegative(double v) { return Double.isFinite(v) && v >= 0; }

    private History requireHistory(String id) {
        History h = id == null ? null : histories.get(id);
        if (h == null) throw new ResourceNotFoundException("Astronauta não encontrado: " + id);
        return h;
    }

    private static double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
