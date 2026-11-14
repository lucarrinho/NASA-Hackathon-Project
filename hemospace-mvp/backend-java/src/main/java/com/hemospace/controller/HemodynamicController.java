package com.hemospace.controller;

import com.hemospace.model.*;
import com.hemospace.service.HemodynamicService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class HemodynamicController {

    private final HemodynamicService service;

    public HemodynamicController(HemodynamicService service) {
        this.service = service;
    }

    @GetMapping("/astronauts/{id}/state")
    public AstronautStateResponse state(@PathVariable String id) {
        return service.getState(id);
    }

    @PostMapping("/readings")
    public AstronautStateResponse readings(@RequestBody ReadingRequest request) {
        return service.processReading(request);
    }

    @PostMapping("/ultrasound/classify")
    public UltrasoundResponse classify(@RequestBody UltrasoundRequest request) {
        return service.classifyUltrasound(request);
    }

    @PostMapping("/demo/preset/{code}")
    public AstronautStateResponse preset(@PathVariable String code) {
        return service.applyDemoPreset(code);
    }
}
