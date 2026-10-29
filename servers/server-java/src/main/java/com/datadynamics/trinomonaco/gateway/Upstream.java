package com.datadynamics.trinomonaco.gateway;

import com.datadynamics.trinomonaco.gateway.GatewayProperties.ClusterTarget;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * One HTTP request to a Trino cluster. {@link HttpUpstream} implements it with
 * {@code java.net.http}; tests run the whole gateway against a fake cluster without a network.
 *
 * <p>Implementations must not follow redirects. A timeout is reported as
 * {@link java.net.http.HttpTimeoutException}; any other transport failure as an {@link IOException}.
 */
public interface Upstream {

  /**
   * @param target the cluster (for per-cluster TLS settings)
   * @param url absolute URL on the cluster
   * @param headers request headers
   * @param body request body, or null
   */
  Response send(ClusterTarget target, String method, String url, Map<String, String> headers, String body)
      throws IOException, InterruptedException;

  /** A cluster response; header names are case-insensitive. */
  record Response(int status, Map<String, List<String>> headers, String body) {
    public Response {
      Map<String, List<String>> h = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
      if (headers != null) headers.forEach((k, v) -> h.computeIfAbsent(k, x -> new java.util.ArrayList<>()).addAll(v));
      headers = h;
      if (body == null) body = "";
    }

    public boolean ok() {
      return status >= 200 && status <= 299;
    }

    /** All values of a header joined with ", " (like the Fetch API's {@code Headers.get}), or null. */
    public String header(String name) {
      List<String> v = headers.get(name);
      return v == null || v.isEmpty() ? null : String.join(", ", v);
    }
  }
}
