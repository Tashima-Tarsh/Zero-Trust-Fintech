const ORIGIN = "https://disha-merchant-saas.onrender.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/health") {
      return env.ASSETS.fetch(request);
    }
    const upstreamUrl = new URL(url.pathname + url.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
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
      responseHeaders.set("x-disha-edge", "cloudflare-pages-render");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    } catch {
      return Response.json({ error: "Backend temporarily unavailable" }, {
        status: 502, headers: { "cache-control": "no-store" }
      });
    }
  }
};
