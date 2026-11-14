package com.hemospace.model;

public record ReadingRequest(
        String astronautId,
        String gravityProfile,
        double armSystolicMmhg,
        double armDiastolicMmhg,
        double ankleSystolicMmhg,
        int heartRateBpm,
        double calfCircumferenceCm,
        double ppgCapillaryRefillSec,
        String ultrasoundPreset
) {}
