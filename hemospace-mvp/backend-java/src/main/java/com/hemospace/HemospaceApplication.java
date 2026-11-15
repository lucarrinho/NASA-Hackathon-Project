package com.hemospace;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * [Dev 1] Spring Boot bootstrap.
 * The model/, service/ and controller/ packages belong to Dev 2 and are
 * discovered automatically by component scan (com.hemospace.*).
 */
@SpringBootApplication
public class HemospaceApplication {

    public static void main(String[] args) {
        SpringApplication.run(HemospaceApplication.class, args);
    }
}
