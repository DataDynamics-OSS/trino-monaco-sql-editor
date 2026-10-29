package com.datadynamics.trinomonaco.gateway;

import java.time.Duration;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * {@code gateway.*} settings, with the Node gateway's defaults.
 *
 * @param prefix route prefix (also the cookie path)
 * @param clusters the only clusters clients may use, by alias
 * @param clustersJson the same as JSON ({@code TRINO_CLUSTERS}); merged into {@code clusters}
 * @param idleTimeout close sessions idle this long (cancelling running queries, rolling back a transaction)
 * @param maxSessionsPerUser concurrent sessions per alias + user
 * @param requestTimeout timeout of each request to the cluster; 0 disables
 * @param allowDdl allow DDL statements (CREATE / ALTER / DROP / …)
 * @param secureCookie mark the session cookie Secure (HTTPS only); disable only for local http dev
 * @param cookieName session cookie name
 * @param allowHeaderAuth also accept {@code X-Session-Id} (non-browser clients)
 * @param source {@code X-Trino-Source} when the client sends none
 * @param loginRateLimitMax failed logins allowed per client + alias + user within the window
 * @param loginRateLimitWindow the rate-limit window
 */
@ConfigurationProperties("gateway")
public record GatewayProperties(
    @DefaultValue("/api") String prefix,
    @DefaultValue Map<String, ClusterTarget> clusters,
    String clustersJson,
    @DefaultValue("30m") Duration idleTimeout,
    @DefaultValue("3") int maxSessionsPerUser,
    @DefaultValue("5m") Duration requestTimeout,
    @DefaultValue("true") boolean allowDdl,
    @DefaultValue("true") boolean secureCookie,
    @DefaultValue("tmsid") String cookieName,
    @DefaultValue("false") boolean allowHeaderAuth,
    @DefaultValue("trino-monaco-gateway") String source,
    @DefaultValue("5") int loginRateLimitMax,
    @DefaultValue("1m") Duration loginRateLimitWindow) {

  /**
   * @param url Trino coordinator URL, e.g. "https://trino.example.com:8443"
   * @param label shown in the login form
   * @param catalog default catalog for new sessions
   * @param schema default schema for new sessions
   * @param authentication "password" (default, Basic auth) or "none" (no authentication; development only)
   * @param insecureTls accept self-signed TLS certificates (development only)
   */
  public record ClusterTarget(String url, String label, String catalog, String schema, String authentication, Boolean insecureTls) {
    public boolean needsPassword() {
      return authentication == null || authentication.equals("password");
    }

    public boolean insecure() {
      return Boolean.TRUE.equals(insecureTls);
    }
  }
}
