/**
 * A Next.js Route Handler's `request.url` reflects the URL the server
 * process itself received the request as -- behind a reverse proxy (any
 * self-hosted deployment: TrueNAS's app ingress, nginx, Authentik, ...),
 * that's the container's own internal bind address (e.g.
 * `https://0.0.0.0:30490`), not the public origin the browser actually
 * used. Next.js does not rewrite `request.url` from `X-Forwarded-*`
 * headers automatically -- Auth.js's own `trustHost` option only affects
 * Auth.js's internal routing, not this app's hand-rolled OAuth connect
 * flow, which needs the same fix applied separately here.
 *
 * Found live: Google rejected "Connect Gmail" with
 * `redirect_uri=https://0.0.0.0:30490/api/connect/google/callback` --
 * unreachable from Google's side, and never what was registered in
 * Google Cloud Console. Reading the standard reverse-proxy forwarded
 * headers (present whenever a proxy sits in front, absent in plain local
 * dev where `request.url`'s own origin is already correct) fixes this for
 * every route that builds an absolute URL from the incoming request, not
 * just the OAuth callback where it was first noticed.
 */
export function getRequestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}
