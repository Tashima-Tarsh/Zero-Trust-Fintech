const ORIGIN = "https://zero-trust-fintech-production.up.railway.app";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Keep the canonical checkout consistent with the Railway Express route.
    if (["/checkout", "/checkout/", "/pay", "/pay/"].includes(url.pathname)) {
      const checkoutUrl = new URL("/checkout.html" + url.search, request.url);
      return env.ASSETS.fetch(new Request(checkoutUrl, request));
    }

    // Authentication and dashboard routes must be resolved by the authenticated
    // Railway app, never as unprotected static HTML on the Pages edge.
    const protectedPath = ["/login", "/signup", "/dashboard", "/payments", "/analytics",
      "/merchant-console.html", "/merchant-dashboard.html", "/auth-config.js"].includes(url.pathname);
    if (!protectedPath && !url.pathname.startsWith("/api/") && url.pathname !== "/health" && !url.pathname.startsWith("/ws")) {
      return env.ASSETS.fetch(request);
    }

    // Proxy API, Health, and WebSocket requests to live Railway backend
    const upstreamUrl = new URL(url.pathname + url.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return fetch(upstreamUrl, {
        method: request.method,
        headers: headers
      });
    }

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    try {
      const upstream = await fetch(upstreamUrl, init);
      if (upstream.status === 101) return upstream;
      const responseHeaders = new Headers(upstream.headers);
      const location = responseHeaders.get("location");
      if (location) {
        const destination = new URL(location, ORIGIN);
        if (destination.origin === ORIGIN) {
          responseHeaders.set("location", url.origin + destination.pathname + destination.search + destination.hash);
        }
      }
      responseHeaders.set("cache-control", "no-store");
      responseHeaders.set("x-disha-edge", "cloudflare-pages-disha82");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      return Response.json({ error: "Backend temporarily unavailable", message: err.message }, {
        status: 502,
        headers: { "cache-control": "no-store" }
      });
    }
  }
};
