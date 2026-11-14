package com.hemospace.model;

import java.util.List;
import java.util.Map;

public record AstronautStateResponse(
        String astronaut_id,
        int mission_day,
        String gravity_profile,
        ComputedMetrics computed_metrics,
        Map<String, ZoneStatusDTO> zones,
        List<HistoryPoint> history
) {
    public record ComputedMetrics(
            double map_mmhg,
            double abi_index,
            double pulse_pressure_mmhg
    ) {}

    public record HistoryPoint(
            int mission_day,
            double map_mmhg,
            double abi_index,
            int heart_rate_bpm
    ) {}
}
