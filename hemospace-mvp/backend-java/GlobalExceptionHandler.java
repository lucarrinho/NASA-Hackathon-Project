package com.hemospace.controller;

import com.hemospace.service.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleValidation(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", "INVALID_READING", "message", ex.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> handleMalformed(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", "INVALID_PAYLOAD", "message", "JSON malformado ou com tipos inválidos."));
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(ResourceNotFoundException ex) {
        return ResponseEntity.status(404).body(Map.of("error", "NOT_FOUND", "message", ex.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGeneral(Exception ex) {
        log.error("Erro interno", ex);
        return ResponseEntity.status(500).body(Map.of("error", "INTERNAL_ERROR", "message", "Erro interno no processamento."));
    }
}
