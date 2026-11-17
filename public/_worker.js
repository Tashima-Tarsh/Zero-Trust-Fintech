const ORIGIN = "https://disha8-2.thenitishkr.in";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Static assets & HTML routes
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/health" && !url.pathname.startsWith("/ws")) {
      if (url.pathname === "/checkout" || url.pathname === "/pay") {
        return env.ASSETS.fetch(new Request(new URL("/checkout.html", url.origin), request));
      }
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
