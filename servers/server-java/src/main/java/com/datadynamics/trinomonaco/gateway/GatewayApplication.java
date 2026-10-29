package com.datadynamics.trinomonaco.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.Bean;

/**
 * Start the gateway.
 *
 * <pre>java -jar target/trino-monaco-gateway.jar</pre>
 *
 * Configuration: the Node gateway's environment variables (TRINO_CLUSTERS, GATEWAY_HOST,
 * GATEWAY_PORT, GATEWAY_PREFIX, SECURE_COOKIE, ALLOW_DDL, IDLE_TIMEOUT_MIN, REQUEST_TIMEOUT_SEC,
 * MAX_SESSIONS_PER_USER, ALLOW_HEADER_AUTH) — see application.properties — or any
 * {@code gateway.*} Spring property ({@link GatewayProperties}).
 *
 * <p>Run behind HTTPS (reverse proxy) in production.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class GatewayApplication {

  /** {@code java.net.http}; an application (or test) can supply its own {@link Upstream} bean instead. */
  @Bean
  @ConditionalOnMissingBean(Upstream.class)
  Upstream upstream(GatewayProperties properties) {
    return new HttpUpstream(properties.requestTimeout());
  }

  public static void main(String[] args) {
    SpringApplication.run(GatewayApplication.class, args);
  }
}
