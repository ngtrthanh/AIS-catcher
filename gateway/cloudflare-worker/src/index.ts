type RouteId =
  | "stats"
  | "ships"
  | "ships_compact"
  | "ships_full"
  | "ship_detail"
  | "paths"
  | "path_detail"
  | "history"
  | "stream"
  | "signal_stream"
  | "decode"
  | "vessel_message";

type RouteDef = {
  id: RouteId;
  method: "GET" | "POST";
  pattern: URLPattern;
  cacheable: boolean;
  upstream: (match: URLPatternResult, request: Request) => Promise<UpstreamRequest>;
};

type UpstreamRequest = {
  path: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: HeadersInit;
};

type TierDefinition = {
  allowedRoutes: string[];
  cacheTtlSeconds?: number;
  artificialDelayMs?: number;
};

type ApiKeyDefinition = {
  tier: string;
  tenantId?: string;
  disabled?: boolean;
};

type TierConfigPayload = {
  tiers: Record<string, TierDefinition>;
};

type ApiKeysPayload = Record<string, ApiKeyDefinition>;

interface Env {
  AIS_API_BASE_URL: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_CACHE_TTL?: string;
  DEFAULT_DELAY_MS?: string;
  TIER_CONFIG_JSON?: string;
  API_KEYS_JSON?: string;
}

type AuthContext = {
  apiKey: string;
  tierName: string;
  tenantId: string;
  tier: TierDefinition;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const routes: RouteDef[] = [
  {
    id: "stats",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/stats" }),
    cacheable: true,
    upstream: async () => ({ path: "/api/stat.json" }),
  },
  {
    id: "ships",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/ships" }),
    cacheable: true,
    upstream: async () => ({ path: "/api/ships.json" }),
  },
  {
    id: "ships_compact",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/ships/compact" }),
    cacheable: true,
    upstream: async () => ({ path: "/api/ships_array.json" }),
  },
  {
    id: "ships_full",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/ships/full" }),
    cacheable: false,
    upstream: async () => ({ path: "/api/ships_full.json" }),
  },
  {
    id: "ship_detail",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/ships/:mmsi" }),
    cacheable: true,
    upstream: async (match) => ({ path: `/api/vessel?${match.pathname.groups.mmsi}` }),
  },
  {
    id: "paths",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/paths" }),
    cacheable: false,
    upstream: async () => ({ path: "/api/allpath.geojson" }),
  },
  {
    id: "path_detail",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/paths/:mmsi" }),
    cacheable: true,
    upstream: async (match) => ({ path: `/api/path.geojson?${match.pathname.groups.mmsi}` }),
  },
  {
    id: "history",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/history" }),
    cacheable: true,
    upstream: async () => ({ path: "/api/history_full.json" }),
  },
  {
    id: "stream",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/stream" }),
    cacheable: false,
    upstream: async () => ({ path: "/api/sse" }),
  },
  {
    id: "signal_stream",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/signal-stream" }),
    cacheable: false,
    upstream: async () => ({ path: "/api/signal" }),
  },
  {
    id: "decode",
    method: "POST",
    pattern: new URLPattern({ pathname: "/v1/decode" }),
    cacheable: false,
    upstream: async (_match, request) => {
      const contentType = request.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? extractDecodeInputFromJson(await request.text())
        : await request.text();

      return {
        path: "/api/decode",
        method: "POST",
        body,
        headers: { "content-type": "text/plain; charset=utf-8" },
      };
    },
  },
  {
    id: "vessel_message",
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/messages/:mmsi" }),
    cacheable: true,
    upstream: async (match) => ({ path: `/api/message?${match.pathname.groups.mmsi}` }),
  },
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS")
      return handleOptions(request, env);

    try {
      const url = new URL(request.url);
      const routeMatch = resolveRoute(request, url);
      if (!routeMatch)
        return withCors(request, env, jsonResponse({ error: "Route not found" }, 404));

      const auth = authenticate(request, env);
      if (auth instanceof Response)
        return withCors(request, env, auth);

      if (!isRouteAllowed(auth.tier, routeMatch.route.id))
        return withCors(request, env, jsonResponse({ error: "Route not available for this tier" }, 403));

      const delayMs = auth.tier.artificialDelayMs ?? parseInteger(env.DEFAULT_DELAY_MS, 0);
      if (delayMs > 0)
        await sleep(delayMs);

      const upstreamRequest = await routeMatch.route.upstream(routeMatch.match, request);
      const upstreamResponse = await proxyToOrigin(request, env, routeMatch.route, upstreamRequest, auth, ctx);
      return withCors(request, env, upstreamResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected gateway error";
      return withCors(request, env, jsonResponse({ error: message }, 500));
    }
  },
};

function resolveRoute(request: Request, url: URL): { route: RouteDef; match: URLPatternResult } | null {
  for (const route of routes) {
    if (route.method !== request.method)
      continue;

    const match = route.pattern.exec(url);
    if (match)
      return { route, match };
  }

  return null;
}

function authenticate(request: Request, env: Env): AuthContext | Response {
  const apiKey = getApiKey(request);
  if (!apiKey)
    return jsonResponse({ error: "Missing API key" }, 401);

  const keys = loadApiKeys(env);
  const entry = keys[apiKey];
  if (!entry || entry.disabled)
    return jsonResponse({ error: "Invalid API key" }, 401);

  const tiers = loadTiers(env);
  const tier = tiers[entry.tier];
  if (!tier)
    return jsonResponse({ error: `Tier not configured: ${entry.tier}` }, 500);

  return {
    apiKey,
    tierName: entry.tier,
    tenantId: entry.tenantId ?? "default",
    tier,
  };
}

function getApiKey(request: Request): string | null {
  const headerKey = request.headers.get("x-api-key");
  if (headerKey)
    return headerKey.trim();

  const authHeader = request.headers.get("authorization");
  if (!authHeader)
    return null;

  const [scheme, token] = authHeader.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token)
    return null;

  return token.trim();
}

function loadTiers(env: Env): Record<string, TierDefinition> {
  if (env.TIER_CONFIG_JSON) {
    const parsed = JSON.parse(env.TIER_CONFIG_JSON) as TierConfigPayload;
    return parsed.tiers;
  }

  return {
    free: { allowedRoutes: ["stats", "ships_compact"], cacheTtlSeconds: 15, artificialDelayMs: 1000 },
    basic: { allowedRoutes: ["stats", "ships", "ship_detail", "paths"], cacheTtlSeconds: 5, artificialDelayMs: 250 },
    pro: { allowedRoutes: ["stats", "ships", "ships_compact", "ships_full", "ship_detail", "paths", "path_detail", "history", "stream", "signal_stream", "decode", "vessel_message"], cacheTtlSeconds: 0, artificialDelayMs: 0 },
  };
}

function loadApiKeys(env: Env): ApiKeysPayload {
  if (env.API_KEYS_JSON)
    return JSON.parse(env.API_KEYS_JSON) as ApiKeysPayload;

  return {
    "demo-free-key": { tier: "free", tenantId: "demo-free" },
    "demo-basic-key": { tier: "basic", tenantId: "demo-basic" },
    "demo-pro-key": { tier: "pro", tenantId: "demo-pro" },
  };
}

function isRouteAllowed(tier: TierDefinition, routeId: RouteId): boolean {
  return tier.allowedRoutes.includes("*") || tier.allowedRoutes.includes(routeId);
}

async function proxyToOrigin(
  request: Request,
  env: Env,
  route: RouteDef,
  upstreamRequest: UpstreamRequest,
  auth: AuthContext,
  ctx: ExecutionContext,
): Promise<Response> {
  const originUrl = new URL(upstreamRequest.path, ensureTrailingSlash(env.AIS_API_BASE_URL));
  const cacheTtl = route.cacheable ? auth.tier.cacheTtlSeconds ?? parseInteger(env.DEFAULT_CACHE_TTL, 0) : 0;
  const cacheKey = makeCacheKey(request, auth, route);

  if (request.method === "GET" && cacheTtl > 0) {
    const cached = await caches.default.match(cacheKey);
    if (cached)
      return appendGatewayHeaders(cached, auth, "HIT");
  }

  const upstreamResponse = await fetch(originUrl.toString(), {
    method: upstreamRequest.method ?? request.method,
    body: upstreamRequest.body,
    headers: upstreamRequest.headers,
    redirect: "follow",
  });

  const response = new Response(upstreamResponse.body, upstreamResponse);
  response.headers.delete("access-control-allow-origin");
  response.headers.set("x-ais-tier", auth.tierName);
  response.headers.set("x-ais-tenant", auth.tenantId);
  response.headers.set("x-ais-upstream-path", originUrl.pathname);

  if (request.method === "GET" && cacheTtl > 0 && upstreamResponse.ok) {
    response.headers.set("cache-control", `public, max-age=${cacheTtl}`);
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return appendGatewayHeaders(response, auth, "MISS");
  }

  return appendGatewayHeaders(response, auth, "BYPASS");
}

function makeCacheKey(request: Request, auth: AuthContext, route: RouteDef): Request {
  const url = new URL(request.url);
  url.searchParams.set("__tier", auth.tierName);
  url.searchParams.set("__route", route.id);
  return new Request(url.toString(), { method: "GET" });
}

function appendGatewayHeaders(response: Response, auth: AuthContext, cacheStatus: "HIT" | "MISS" | "BYPASS"): Response {
  const next = new Response(response.body, response);
  next.headers.set("x-ais-tier", auth.tierName);
  next.headers.set("x-ais-tenant", auth.tenantId);
  next.headers.set("x-ais-cache", cacheStatus);
  return next;
}

function extractDecodeInputFromJson(text: string): string {
  const payload = JSON.parse(text) as { input?: string; nmea?: string };
  const input = payload.input ?? payload.nmea ?? "";
  if (!input)
    throw new Error("Decode request body must contain input or nmea");
  return input;
}

function handleOptions(request: Request, env: Env): Response {
  const response = new Response(null, { status: 204 });
  return withCors(request, env, response);
}

function withCors(request: Request, env: Env, response: Response): Response {
  const next = new Response(response.body, response);
  const origin = request.headers.get("origin");
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

  if (origin && (allowedOrigins.has("*") || allowedOrigins.has(origin))) {
    next.headers.set("access-control-allow-origin", allowedOrigins.has("*") ? "*" : origin);
    next.headers.set("vary", "Origin");
  }

  next.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  next.headers.set("access-control-allow-headers", "authorization,content-type,x-api-key");
  return next;
}

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw)
    return new Set(["*"]);

  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (!raw)
    return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
