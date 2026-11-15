package com.hemospace.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Testes de contrato HTTP (JSON snake_case na resposta, camelCase na entrada, códigos de erro). */
@SpringBootTest
@AutoConfigureMockMvc
class HemodynamicControllerTest {

    @Autowired
    MockMvc mvc;

    private static final String VALID_READING = """
            {"astronautId":"AST-04","gravityProfile":"0G_ORBIT","armSystolicMmhg":118,
             "armDiastolicMmhg":76,"ankleSystolicMmhg":112,"heartRateBpm":68,
             "calfCircumferenceCm":35.0,"ppgCapillaryRefillSec":1.5,"ultrasoundPreset":"NORMAL"}""";

    @Test
    void presetA_todasVerdes() throws Exception {
        mvc.perform(post("/api/v1/demo/preset/A"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.computed_metrics.map_mmhg").value(90.0))
                .andExpect(jsonPath("$.computed_metrics.abi_index").value(0.95))
                .andExpect(jsonPath("$.zones.head_neck.status").value("GREEN"))
                .andExpect(jsonPath("$.zones.thorax_heart.status").value("GREEN"))
                .andExpect(jsonPath("$.zones.upper_limbs.status").value("GREEN"))
                .andExpect(jsonPath("$.zones.lower_limbs.status").value("GREEN"));
    }

    @Test
    void presetB_cabecaVermelha_pernasAzuis() throws Exception {
        mvc.perform(post("/api/v1/demo/preset/B"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.computed_metrics.abi_index").value(0.78))
                .andExpect(jsonPath("$.zones.head_neck.status").value("RED"))
                .andExpect(jsonPath("$.zones.lower_limbs.status").value("BLUE"));
    }

    @Test
    void presetC_alertaOrtostatico_marte() throws Exception {
        mvc.perform(post("/api/v1/demo/preset/C"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.gravity_profile").value("3_8G_MARS"))
                .andExpect(jsonPath("$.computed_metrics.pulse_pressure_mmhg").value(28.0))
                .andExpect(jsonPath("$.zones.thorax_heart.status").value("YELLOW"));
    }

    @Test
    void readings_validoRetornaQuatroZonasEHistoricoDeSeteDias() throws Exception {
        mvc.perform(post("/api/v1/readings").contentType(MediaType.APPLICATION_JSON).content(VALID_READING))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.astronaut_id").value("AST-04"))
                .andExpect(jsonPath("$.zones.length()").value(4))
                .andExpect(jsonPath("$.history.length()").value(7));
    }

    @Test
    void readings_presetDeUltrassomDaAba3EhRecusado() throws Exception {
        // o api.js converte 'jugular_dilated' -> 'DILATED'; o Java deve recusar o id cru
        mvc.perform(post("/api/v1/readings").contentType(MediaType.APPLICATION_JSON)
                        .content(VALID_READING.replace("\"NORMAL\"", "\"jugular_dilated\"")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_READING"));
    }

    @Test
    void readings_sistolicaMenorQueDiastolicaEhRecusada() throws Exception {
        mvc.perform(post("/api/v1/readings").contentType(MediaType.APPLICATION_JSON)
                        .content(VALID_READING.replace("\"armSystolicMmhg\":118", "\"armSystolicMmhg\":60")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void readings_jsonMalformadoRetorna400_nunca500() throws Exception {
        mvc.perform(post("/api/v1/readings").contentType(MediaType.APPLICATION_JSON).content("{nao-eh-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_PAYLOAD"));
    }

    @Test
    void ultrassom_jugularDilatadaAmarelo_femoralReduzidaAzul() throws Exception {
        mvc.perform(post("/api/v1/ultrasound/classify").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"astronautId\":\"AST-04\",\"region\":\"JUGULAR\",\"ultrasoundPreset\":\"DILATED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.region").value("head_neck"))
                .andExpect(jsonPath("$.status").value("YELLOW"));
        mvc.perform(post("/api/v1/ultrasound/classify").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"astronautId\":\"AST-04\",\"region\":\"FEMORAL\",\"ultrasoundPreset\":\"REDUCED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.region").value("lower_limbs"))
                .andExpect(jsonPath("$.status").value("BLUE"));
    }

    @Test
    void ultrassom_combinacaoInvalidaRetorna400() throws Exception {
        mvc.perform(post("/api/v1/ultrasound/classify").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"astronautId\":\"AST-04\",\"region\":\"JUGULAR\",\"ultrasoundPreset\":\"REDUCED\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void recursosInexistentesRetornam404() throws Exception {
        mvc.perform(post("/api/v1/demo/preset/Z")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/astronauts/AST-99/state")).andExpect(status().isNotFound());
    }

    @Test
    void estadoInicialDoAstronauta() throws Exception {
        mvc.perform(get("/api/v1/astronauts/AST-04/state"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mission_day").value(42))
                .andExpect(jsonPath("$.history.length()").value(7));
    }
}
