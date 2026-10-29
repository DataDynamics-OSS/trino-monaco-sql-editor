package com.datadynamics.trinomonaco.gateway;

import com.datadynamics.trinomonaco.gateway.GatewayProperties.ClusterTarget;
import java.io.IOException;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509ExtendedTrustManager;

/**
 * {@link Upstream} with {@code java.net.http}: HTTP/1.1, no redirects, the configured request
 * timeout (whole request including the body; 0 disables), and a trust-all TLS context only for
 * clusters marked {@code insecureTls}.
 */
final class HttpUpstream implements Upstream {

  private final Duration timeout;
  private final HttpClient client;
  private volatile HttpClient insecureClient;

  HttpUpstream(Duration timeout) {
    this.timeout = timeout == null ? Duration.ZERO : timeout;
    this.client = builder().build();
  }

  private static HttpClient.Builder builder() {
    return HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).followRedirects(HttpClient.Redirect.NEVER);
  }

  private HttpClient client(ClusterTarget target) {
    if (!target.insecure()) return client;
    HttpClient c = insecureClient;
    if (c == null) {
      synchronized (this) {
        if (insecureClient == null) insecureClient = builder().sslContext(trustAll()).build();
        c = insecureClient;
      }
    }
    return c;
  }

  /** Accepts any certificate and host name (the trust manager does the endpoint check, so a no-op skips it). */
  private static SSLContext trustAll() {
    TrustManager tm = new X509ExtendedTrustManager() {
      @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
      @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
      @Override public void checkClientTrusted(X509Certificate[] chain, String authType, Socket socket) {}
      @Override public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) {}
      @Override public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine engine) {}
      @Override public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine engine) {}
      @Override public X509Certificate[] getAcceptedIssuers() {
        return new X509Certificate[0];
      }
    };
    try {
      SSLContext ctx = SSLContext.getInstance("TLS");
      ctx.init(null, new TrustManager[] {tm}, null);
      return ctx;
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  @Override
  public Response send(ClusterTarget target, String method, String url, Map<String, String> headers, String body)
      throws IOException, InterruptedException {
    HttpRequest.Builder b;
    try {
      b = HttpRequest.newBuilder(URI.create(url));
    } catch (IllegalArgumentException e) {
      throw new IOException("Invalid cluster URL: " + e.getMessage(), e);
    }
    boolean contentType = false;
    for (Map.Entry<String, String> h : headers.entrySet()) {
      b.header(h.getKey(), h.getValue());
      contentType |= h.getKey().equalsIgnoreCase("content-type");
    }
    if (body != null && !contentType) b.header("Content-Type", "text/plain; charset=utf-8");
    b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
    boolean timed = !timeout.isZero() && !timeout.isNegative();
    if (timed) b.timeout(timeout);

    CompletableFuture<HttpResponse<String>> f = client(target).sendAsync(b.build(), HttpResponse.BodyHandlers.ofString());
    HttpResponse<String> r;
    try {
      r = timed ? f.get(timeout.toMillis(), TimeUnit.MILLISECONDS) : f.get();
    } catch (TimeoutException e) {
      f.cancel(true);
      throw new HttpTimeoutException("The request to the cluster timed out");
    } catch (InterruptedException e) {
      f.cancel(true);
      throw e;
    } catch (ExecutionException e) {
      Throwable cause = e.getCause();
      if (cause instanceof IOException io) throw io;
      throw new IOException(String.valueOf(cause), cause);
    }
    int s = r.statusCode();
    if (s == 301 || s == 302 || s == 303 || s == 307 || s == 308) {
      throw new IOException("Unexpected redirect from the cluster (HTTP " + s + ")");
    }
    return new Response(s, r.headers().map(), r.body());
  }
}
