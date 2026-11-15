package com.hemospace.service;

import com.hemospace.model.ReadingRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hemospace.model.AstronautStateResponse;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class HemodynamicServiceTest {

    private final HemodynamicService s = new HemodynamicService(new ObjectMapper());

    @Test
    void formulas() {
        assertEquals(93.33, s.calculateMAP(120, 80), 0.01);
        assertEquals(0.90, s.calculateABI(108, 120), 0.001);
        assertEquals(40, s.calculatePulsePressure(120, 80), 0.001);
        assertThrows(IllegalArgumentException.class, () -> s.calculateABI(100, 0));
    }

    @Test
    void boundaries() {
        assertEquals("GREEN", s.classifyMAP(70));
        assertEquals("GREEN", s.classifyMAP(100));
        assertEquals("BLUE", s.classifyABI(0.90));;
        assertEquals("GREEN", s.classifyABI(1.30));
        assertEquals("GREEN", s.classifyPulsePressure(25));
        assertEquals("GREEN", s.classifyPulsePressure(60));
    }

    @Test
    void scenarioA_allGreen() {
        AstronautStateResponse r = s.applyDemoPreset("A");
        assertEquals(90.0, r.computed_metrics().map_mmhg(), 0.01);
        assertEquals(0.95, r.computed_metrics().abi_index(), 0.01);
        r.zones().values().forEach(z -> assertEquals("GREEN", z.status()));
        assertEquals(7, r.history().size());
    }

    @Test
    void scenarioB_headRed_legsBlue() {
        AstronautStateResponse r = s.applyDemoPreset("B");
        assertEquals(104.67, r.computed_metrics().map_mmhg(), 0.01);
        assertEquals(0.78, r.computed_metrics().abi_index(), 0.01);
        assertEquals("RED", r.zones().get("head_neck").status());
        assertEquals("BLUE", r.zones().get("lower_limbs").status());
    }

    @Test
    void scenarioC_orthostaticAlert() {
        AstronautStateResponse r = s.applyDemoPreset("C");
        assertEquals(77.33, r.computed_metrics().map_mmhg(), 0.01);
        assertEquals(28, r.computed_metrics().pulse_pressure_mmhg(), 0.01);
        assertEquals("YELLOW", r.zones().get("thorax_heart").status());
    }

    @Test
    void unknownResources() {
        assertThrows(ResourceNotFoundException.class, () -> s.applyDemoPreset("Z"));
        assertThrows(ResourceNotFoundException.class, () -> s.getState("AST-99"));
    }

 @Test
    void newRules_abi_pp_head_capillaryRefill() {
        // ABI
        assertEquals("BLUE", s.classifyABI(0.90));
        assertEquals("GREEN", s.classifyABI(1.40));
        assertEquals("YELLOW", s.classifyABI(1.41));
        // proportional pulse pressure
        assertEquals("RED", s.classifyPulsePressure(35, 160));   // 21.9% of systolic
        assertEquals("GREEN", s.classifyPulsePressure(42, 118));
        // head: jugular weighs more; ABI alone only yellow; red requires confirmation
        assertEquals("YELLOW", zone(118, 76, 100, 1.5, "NORMAL", "head_neck"));
        assertEquals("YELLOW", zone(118, 76, 112, 1.5, "DILATED", "head_neck"));
        assertEquals("RED",    zone(118, 76, 100, 1.5, "DILATED", "head_neck"));
        // slow capillary refill: arms yellow
        assertEquals("GREEN",  zone(118, 76, 112, 2.0, "NORMAL", "upper_limbs"));
        assertEquals("YELLOW", zone(118, 76, 112, 2.5, "NORMAL", "upper_limbs"));
        // ABI exactly 0.90 -> legs blue
        assertEquals("BLUE",   zone(120, 80, 108, 1.5, "NORMAL", "lower_limbs"));
    }

    @Test
    void orthostaticAlert_isLabeledAsDemo() {
        String label = s.applyDemoPreset("C").zones().get("thorax_heart").label();
        assertTrue(label.contains("demo"));
    }

    private String zone(double sys, double dia, double ankle, double ppg, String us, String zoneKey) {
        ReadingRequest r = new ReadingRequest("AST-04", "0G_ORBIT", sys, dia, ankle, 68, 35.0, ppg, us);
        return s.processReading(r).zones().get(zoneKey).status();
    }

}
