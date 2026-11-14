package com.hemospace.service;

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
        assertEquals("GREEN", s.classifyABI(0.90));
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
}
