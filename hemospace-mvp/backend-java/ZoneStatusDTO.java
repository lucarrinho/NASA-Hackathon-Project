package com.hemospace.model;

/** status: BLUE | GREEN | YELLOW | RED */
public record ZoneStatusDTO(
        String status,
        String label,
        String action
) {}
