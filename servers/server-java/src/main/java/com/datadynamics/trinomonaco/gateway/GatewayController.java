package com.datadynamics.trinomonaco.gateway;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The gateway HTTP API (servers/server-node/README.md) under {@code gateway.prefix}. */
@RestController
@RequestMapping("${gateway.prefix:/api}")
class GatewayController {

  private final SessionManager sessions;
  private final GatewayProperties o;

  GatewayController(SessionManager sessions, GatewayProperties properties) {
    this.sessions = sessions;
    this.o = properties;
  }

  private String cookie(HttpServletRequest req) {
    Cookie[] cookies = req.getCookies();
    if (cookies == null) return null;
    for (Cookie c : cookies) if (c.getName().equals(o.cookieName())) return c.getValue();
    return null;
  }

  private static String header(HttpServletRequest req) {
    return req.getHeader("X-Session-Id");
  }

  /** The raw request body (any or no content type), at most {@link BodyLimitFilter#LIMIT} bytes. */
  private static byte[] body(HttpServletRequest req) throws IOException {
    try (InputStream in = req.getInputStream()) {
      byte[] b = in.readNBytes((int) BodyLimitFilter.LIMIT + 1);
      if (b.length > BodyLimitFilter.LIMIT) throw new ApiError(413, "BODY_TOO_LARGE", "Request body too large");
      return b;
    }
  }

  private static boolean isJson(HttpServletRequest req) {
    String type = req.getContentType();
    if (type == null) return false;
    String t = type.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
    return t.equals("application/json") || (t.startsWith("application/") && t.endsWith("+json"));
  }

  /** Request headers by lower-case name; repeated headers are joined with ", " (like Node). */
  private static Map<String, String> headers(HttpServletRequest req) {
    Map<String, String> out = new HashMap<>();
    for (String name : Collections.list(req.getHeaderNames())) {
      out.put(name.toLowerCase(Locale.ROOT), String.join(", ", Collections.list(req.getHeaders(name))));
    }
    return out;
  }

  /**
   * The rest of the path after {@code /sessions/{id}/v1/statement/}, taken from the raw request
   * URI (not decoded or normalised, so {@code ../} stays visible to the path check).
   */
  private String followPath(HttpServletRequest req, String id) {
    String expected = req.getContextPath() + o.prefix() + "/sessions/" + id + "/v1/statement/";
    String uri = req.getRequestURI();
    return uri.startsWith(expected) ? uri.substring(expected.length()) : "";
  }

  private static ResponseEntity<String> reply(SessionManager.Reply r) {
    if (r.body() == null) return ResponseEntity.status(r.status()).build();
    ResponseEntity.BodyBuilder b = ResponseEntity.status(r.status()).contentType(MediaType.APPLICATION_JSON);
    r.headers().forEach(b::header);
    return b.body(r.body());
  }

  @GetMapping("/aliases")
  List<Map<String, String>> aliases() {
    return sessions.aliases();
  }

  @PostMapping("/sessions")
  ResponseEntity<Map<String, Object>> login(HttpServletRequest req) throws IOException {
    SessionManager.Login login = sessions.login(sessions.loginBody(body(req), isJson(req)), req.getRemoteAddr());
    ResponseCookie cookie = ResponseCookie.from(o.cookieName(), login.sessionId())
        .httpOnly(true)
        .sameSite("Strict")
        .secure(o.secureCookie())
        .path(o.prefix())
        .build();
    return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, cookie.toString()).body(login.body());
  }

  @GetMapping("/sessions/{id}")
  Map<String, Object> session(@PathVariable String id, HttpServletRequest req) {
    return sessions.session(id, cookie(req), header(req));
  }

  @DeleteMapping("/sessions/{id}")
  ResponseEntity<Void> logout(@PathVariable String id, HttpServletRequest req) {
    sessions.logout(id, cookie(req), header(req));
    ResponseCookie clear = ResponseCookie.from(o.cookieName(), "").path(o.prefix()).maxAge(0).build();
    return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, clear.toString()).build();
  }

  /** Trino client protocol: start a statement; the body is the SQL text. */
  @PostMapping("/sessions/{id}/v1/statement")
  ResponseEntity<String> statement(@PathVariable String id, HttpServletRequest req) throws IOException {
    String sql = new String(body(req), StandardCharsets.UTF_8);
    return reply(sessions.statement(id, cookie(req), header(req), sql, headers(req)));
  }

  /** Trino client protocol: follow {@code nextUri}. */
  @GetMapping("/sessions/{id}/v1/statement/**")
  ResponseEntity<String> next(@PathVariable String id, HttpServletRequest req) {
    return reply(sessions.follow(id, cookie(req), header(req), "GET", followPath(req, id)));
  }

  /** Trino client protocol: cancel a query. */
  @DeleteMapping("/sessions/{id}/v1/statement/**")
  ResponseEntity<String> cancel(@PathVariable String id, HttpServletRequest req) {
    return reply(sessions.follow(id, cookie(req), header(req), "DELETE", followPath(req, id)));
  }
}
