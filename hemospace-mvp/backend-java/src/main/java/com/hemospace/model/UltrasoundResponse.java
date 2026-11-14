package com.hemospace.model;

public record UltrasoundResponse(
        String region,
        String classification,
        String status,
        String label,
        String action
) {}
