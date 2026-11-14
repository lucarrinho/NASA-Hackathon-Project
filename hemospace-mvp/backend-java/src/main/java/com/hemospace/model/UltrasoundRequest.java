package com.hemospace.model;

/** region: JUGULAR | FEMORAL ; ultrasoundPreset: NORMAL | DILATED | REDUCED */
public record UltrasoundRequest(
        String astronautId,
        String region,
        String ultrasoundPreset
) {}
