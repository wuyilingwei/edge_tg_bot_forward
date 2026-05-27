/**
 * edge-tg-bot-forward
 *
 * Cloudflare Workers edge proxy for Telegram Bot API.
 * Forwards requests to api.telegram.org only for allowlisted bot tokens.
 *
 * URL formats supported:
 *   /bot{token}/{method}         — standard Telegram Bot API format
 *   /{token}/{method}            — shorthand format
 *   /file/bot{token}/{filepath}  — file download proxy
 *
 * Environment variables:
 *   ALLOWED_TOKENS  — comma-separated list of authorized bot tokens
 *                     e.g. "123456:ABC-DEF,789012:XYZ-GHI"
 *                     Set via `wrangler secret put ALLOWED_TOKENS` or CF Dashboard
 */

const TG_API_BASE = "https://api.telegram.org";

/** Shape of the Worker environment bindings */
export interface Env {
  /** Comma-separated authorized bot tokens */
  ALLOWED_TOKENS: string;
}

// ---------------------------------------------------------------------------
// Token parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse `ALLOWED_TOKENS` env var into an immutable Set.
 * Trims whitespace and filters empty entries.
 */
function buildAllowedSet(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

/**
 * Attempt to extract the bot token from the incoming request URL.
 *
 * Recognised path patterns:
 *   /bot<token>/<method>...          → token = <token>
 *   /<token>/<method>...             → token = <token>  (shorthand)
 *   /file/bot<token>/<filepath>...   → token = <token>  (file download)
 *
 * Returns null when the path doesn't match any known pattern.
 */
function extractToken(pathname: string): { token: string; upstream: string } | null {
  // Pattern 1: /bot{token}/{rest}
  const botPrefixMatch = pathname.match(/^\/bot([^/]+)(\/.*)?$/);
  if (botPrefixMatch) {
    const token = botPrefixMatch[1] ?? "";
    const rest = botPrefixMatch[2] ?? "/";
    return {
      token,
      upstream: `/bot${token}${rest}`,
    };
  }

  // Pattern 2: /file/bot{token}/{rest}
  const filePrefixMatch = pathname.match(/^\/file\/bot([^/]+)(\/.*)?$/);
  if (filePrefixMatch) {
    const token = filePrefixMatch[1] ?? "";
    const rest = filePrefixMatch[2] ?? "/";
    return {
      token,
      upstream: `/file/bot${token}${rest}`,
    };
  }

  // Pattern 3: /{token}/{rest}  (shorthand — token contains a colon)
  const shorthandMatch = pathname.match(/^\/([^/]+:[^/]+)(\/.*)?$/);
  if (shorthandMatch) {
    const token = shorthandMatch[1] ?? "";
    const rest = shorthandMatch[2] ?? "/";
    return {
      token,
      upstream: `/bot${token}${rest}`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/** Generic opaque 404 — reveals nothing about why the request was rejected */
function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

/** Return a minimal CORS preflight response */
function handleOptions(request: Request): Response {
  const origin = request.headers.get("Origin") ?? "*";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// ---------------------------------------------------------------------------
// Core proxy logic
// ---------------------------------------------------------------------------

/**
 * Forward the request to Telegram's API and stream the response back.
 * Preserves method, headers (minus host), and body.
 */
async function proxyToTelegram(
  request: Request,
  upstreamPath: string,
  upstreamQuery: string
): Promise<Response> {
  const upstreamUrl = `${TG_API_BASE}${upstreamPath}${upstreamQuery ? "?" + upstreamQuery : ""}`;

  // Build upstream request — clone and strip hop-by-hop / host headers
  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.delete("host");
  upstreamHeaders.delete("cf-connecting-ip");
  upstreamHeaders.delete("cf-ipcountry");
  upstreamHeaders.delete("cf-ray");
  upstreamHeaders.delete("cf-visitor");
  upstreamHeaders.delete("x-forwarded-for");
  upstreamHeaders.delete("x-forwarded-proto");
  upstreamHeaders.delete("x-real-ip");

  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
    // Enable streaming for large file uploads / downloads
    // @ts-expect-error — duplex is supported in Workers but not in TS types yet
    duplex: "half",
  });

  const upstream = await fetch(upstreamRequest);

  // Stream response back, adding CORS headers
  const origin = request.headers.get("Origin") ?? "*";
  const responseHeaders = new Headers(upstream.headers);

  // Inject CORS headers so browser clients work
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    responseHeaders.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    // Validate environment configuration
    const rawTokens = env.ALLOWED_TOKENS ?? "";
    if (!rawTokens.trim()) {
      // Misconfigured worker — return opaque error
      return notFound();
    }

    const allowedSet = buildAllowedSet(rawTokens);

    // Extract token from URL
    const parsed = extractToken(url.pathname);
    if (!parsed) {
      return notFound();
    }

    const { token, upstream: upstreamPath } = parsed;

    // Token allowlist check — O(1) lookup
    if (!allowedSet.has(token)) {
      // Silently drop — return the same 404 as any unknown path
      return notFound();
    }

    // Proxy the request
    return proxyToTelegram(request, upstreamPath, url.searchParams.toString());
  },
} satisfies ExportedHandler<Env>;
