package com.hemospace;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * [Dev 1] Bootstrap do Spring Boot.
 * Os pacotes model/, service/ e controller/ pertencem ao Dev 2 e são
 * descobertos automaticamente pelo component scan (com.hemospace.*).
 */
@SpringBootApplication
public class HemospaceApplication {

    public static void main(String[] args) {
        SpringApplication.run(HemospaceApplication.class, args);
    }
}
