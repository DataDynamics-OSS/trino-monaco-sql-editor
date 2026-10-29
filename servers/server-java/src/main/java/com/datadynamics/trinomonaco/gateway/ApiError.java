package com.datadynamics.trinomonaco.gateway;

import java.util.LinkedHashMap;
import java.util.Map;

/** An HTTP error response: {@code { error: { code, message } }}. */
public final class ApiError extends RuntimeException {
  final int status;
  final Map<String, Object> body = new LinkedHashMap<>();

  public ApiError(int status, String code, String message) {
    super(message, null, false, false);
    this.status = status;
    body.put("code", code);
    body.put("message", message);
  }

  public Map<String, Object> response() {
    return Map.of("error", body);
  }
}
