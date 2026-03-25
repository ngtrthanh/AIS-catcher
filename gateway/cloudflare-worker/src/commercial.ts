export type D1Row = Record<string, unknown>;

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  first<T = D1Row>(): Promise<T | null>;
  all<T = D1Row>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedLike;
}

export type CommercialEnv = {
  DB?: D1DatabaseLike;
  ADMIN_API_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
};

export type CommercialTier = {
  allowedRoutes: string[];
  cacheTtlSeconds?: number;
  artificialDelayMs?: number;
};

export type CommercialAuthContext = {
  apiKey: string;
  apiKeyId: string;
  orgId: string;
  orgName: string;
  tenantId: string;
  tierName: string;
  tier: CommercialTier;
};

type PlanRow = {
  id: string;
  name: string;
  routes_json: string;
  limits_json: string;
};

type OrgRow = {
  id: string;
  name: string;
  billing_email: string | null;
  plan_id: string;
  stripe_customer_id: string | null;
};

type ApiKeyRow = {
  id: string;
  org_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes_json: string | null;
  status: string;
};

export async function authenticateCommercialKey(request: Request, env: CommercialEnv): Promise<CommercialAuthContext | null> {
  if (!env.DB)
    return null;

  const apiKey = extractApiKey(request);
  if (!apiKey)
    return null;

  const split = apiKey.split(".", 2);
  if (split.length !== 2)
    return null;

  const [prefix, secret] = split;
  const keyRow = await env.DB
    .prepare("SELECT id, org_id, name, key_prefix, key_hash, scopes_json, status FROM api_keys WHERE key_prefix = ? AND status = 'active' LIMIT 1")
    .bind(prefix)
    .first<ApiKeyRow>();

  if (!keyRow)
    return null;

  const hashed = await sha256hex(secret);
  if (hashed !== keyRow.key_hash)
    return null;

  const org = await env.DB
    .prepare("SELECT id, name, billing_email, plan_id, stripe_customer_id FROM organizations WHERE id = ? AND status = 'active' LIMIT 1")
    .bind(keyRow.org_id)
    .first<OrgRow>();

  if (!org)
    return null;

  const plan = await env.DB
    .prepare("SELECT id, name, routes_json, limits_json FROM plans WHERE id = ? LIMIT 1")
    .bind(org.plan_id)
    .first<PlanRow>();

  if (!plan)
    return null;

  const allowedRoutes = keyRow.scopes_json
    ? JSON.parse(keyRow.scopes_json) as string[]
    : JSON.parse(plan.routes_json) as string[];

  await env.DB
    .prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(keyRow.id)
    .run();

  return {
    apiKey,
    apiKeyId: keyRow.id,
    orgId: org.id,
    orgName: org.name,
    tenantId: org.id,
    tierName: plan.id,
    tier: {
      allowedRoutes,
      ...JSON.parse(plan.limits_json || "{}"),
    },
  };
}

export async function handleAdminRequest(request: Request, env: CommercialEnv): Promise<Response | null> {
  if (!request.url.includes("/admin/"))
    return null;

  if (!env.DB)
    return json({ error: "D1 database binding is required for admin endpoints" }, 500);

  if (!isAdminAuthorized(request, env))
    return json({ error: "Unauthorized admin request" }, 401);

  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/admin/plans")
    return listPlans(env);

  if (request.method === "POST" && url.pathname === "/admin/plans")
    return createPlan(request, env);

  if (request.method === "GET" && url.pathname === "/admin/orgs")
    return listOrganizations(env);

  if (request.method === "POST" && url.pathname === "/admin/orgs")
    return createOrganization(request, env);

  if (request.method === "GET" && url.pathname === "/admin/api-keys")
    return listApiKeys(url, env);

  if (request.method === "POST" && url.pathname === "/admin/api-keys")
    return createApiKey(request, env);

  if (request.method === "GET" && url.pathname === "/admin/usage")
    return getUsageSummary(url, env);

  if (request.method === "GET" && url.pathname === "/admin/invoices")
    return listInvoices(url, env);

  if (request.method === "POST" && url.pathname === "/admin/invoices")
    return createInvoice(request, env);

  if (request.method === "POST" && url.pathname === "/admin/stripe/customers")
    return createStripeCustomer(request, env);

  return json({ error: "Admin route not found" }, 404);
}

export async function logUsageEvent(
  env: CommercialEnv,
  auth: CommercialAuthContext,
  routeId: string,
  method: string,
  statusCode: number,
): Promise<void> {
  if (!env.DB)
    return;

  await env.DB
    .prepare("INSERT INTO usage_events (id, org_id, api_key_id, route_id, method, status_code, units) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), auth.orgId, auth.apiKeyId, routeId, method, statusCode, 1)
    .run();
}

function isAdminAuthorized(request: Request, env: CommercialEnv): boolean {
  const token = extractBearer(request);
  return !!token && !!env.ADMIN_API_TOKEN && token === env.ADMIN_API_TOKEN;
}

async function listPlans(env: CommercialEnv): Promise<Response> {
  const result = await env.DB!.prepare("SELECT id, name, price_cents, currency, routes_json, limits_json, created_at FROM plans ORDER BY created_at DESC").all();
  return json({ plans: result.results ?? [] });
}

async function createPlan(request: Request, env: CommercialEnv): Promise<Response> {
  const body = await request.json<Record<string, unknown>>();
  const id = stringField(body.id) ?? crypto.randomUUID();
  const name = requiredString(body.name, "name");
  const priceCents = requiredInteger(body.priceCents, "priceCents");
  const currency = stringField(body.currency) ?? "usd";
  const allowedRoutes = arrayOfStrings(body.allowedRoutes, "allowedRoutes");
  const limits = objectField(body.limits) ?? {};

  await env.DB!
    .prepare("INSERT INTO plans (id, name, price_cents, currency, routes_json, limits_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name, priceCents, currency, JSON.stringify(allowedRoutes), JSON.stringify(limits))
    .run();

  return json({ id, name, priceCents, currency, allowedRoutes, limits }, 201);
}

async function listOrganizations(env: CommercialEnv): Promise<Response> {
  const result = await env.DB!
    .prepare("SELECT id, name, billing_email, plan_id, stripe_customer_id, status, created_at FROM organizations ORDER BY created_at DESC")
    .all();
  return json({ organizations: result.results ?? [] });
}

async function createOrganization(request: Request, env: CommercialEnv): Promise<Response> {
  const body = await request.json<Record<string, unknown>>();
  const id = stringField(body.id) ?? crypto.randomUUID();
  const name = requiredString(body.name, "name");
  const billingEmail = stringField(body.billingEmail) ?? null;
  const planId = requiredString(body.planId, "planId");
  const stripeCustomerId = stringField(body.stripeCustomerId) ?? null;

  await env.DB!
    .prepare("INSERT INTO organizations (id, name, billing_email, plan_id, stripe_customer_id) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, billingEmail, planId, stripeCustomerId)
    .run();

  return json({ id, name, billingEmail, planId, stripeCustomerId }, 201);
}

async function listApiKeys(url: URL, env: CommercialEnv): Promise<Response> {
  const orgId = url.searchParams.get("orgId");
  if (!orgId)
    return json({ error: "orgId is required" }, 400);

  const result = await env.DB!
    .prepare("SELECT id, org_id, name, key_prefix, scopes_json, status, last_used_at, created_at FROM api_keys WHERE org_id = ? ORDER BY created_at DESC")
    .bind(orgId)
    .all();

  return json({ apiKeys: result.results ?? [] });
}

async function createApiKey(request: Request, env: CommercialEnv): Promise<Response> {
  const body = await request.json<Record<string, unknown>>();
  const id = crypto.randomUUID();
  const orgId = requiredString(body.orgId, "orgId");
  const name = requiredString(body.name, "name");
  const scopes = body.scopes ? arrayOfStrings(body.scopes, "scopes") : null;

  const keyPrefix = `ais_${randomString(8)}`;
  const secret = randomString(32);
  const issuedKey = `${keyPrefix}.${secret}`;
  const keyHash = await sha256hex(secret);

  await env.DB!
    .prepare("INSERT INTO api_keys (id, org_id, name, key_prefix, key_hash, scopes_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, orgId, name, keyPrefix, keyHash, scopes ? JSON.stringify(scopes) : null)
    .run();

  return json({
    id,
    orgId,
    name,
    issuedKey,
    keyPrefix,
    scopes,
  }, 201);
}

async function getUsageSummary(url: URL, env: CommercialEnv): Promise<Response> {
  const orgId = url.searchParams.get("orgId");
  if (!orgId)
    return json({ error: "orgId is required" }, 400);

  const from = url.searchParams.get("from") ?? "1970-01-01T00:00:00Z";
  const to = url.searchParams.get("to") ?? "2999-12-31T23:59:59Z";

  const result = await env.DB!
    .prepare(`
      SELECT route_id, COUNT(*) AS requests, SUM(units) AS units
      FROM usage_events
      WHERE org_id = ? AND created_at >= ? AND created_at <= ?
      GROUP BY route_id
      ORDER BY requests DESC
    `)
    .bind(orgId, from, to)
    .all();

  return json({ orgId, from, to, usage: result.results ?? [] });
}

async function listInvoices(url: URL, env: CommercialEnv): Promise<Response> {
  const orgId = url.searchParams.get("orgId");
  if (!orgId)
    return json({ error: "orgId is required" }, 400);

  const result = await env.DB!
    .prepare("SELECT id, org_id, amount_cents, currency, description, status, stripe_invoice_id, stripe_invoice_url, created_at FROM invoices WHERE org_id = ? ORDER BY created_at DESC")
    .bind(orgId)
    .all();

  return json({ invoices: result.results ?? [] });
}

async function createInvoice(request: Request, env: CommercialEnv): Promise<Response> {
  const body = await request.json<Record<string, unknown>>();
  const id = crypto.randomUUID();
  const orgId = requiredString(body.orgId, "orgId");
  const amountCents = requiredInteger(body.amountCents, "amountCents");
  const currency = stringField(body.currency) ?? "usd";
  const description = requiredString(body.description, "description");

  const org = await env.DB!
    .prepare("SELECT id, name, billing_email, plan_id, stripe_customer_id FROM organizations WHERE id = ? LIMIT 1")
    .bind(orgId)
    .first<OrgRow>();

  if (!org)
    return json({ error: "Organization not found" }, 404);

  let status = "draft";
  let stripeInvoiceId: string | null = null;
  let stripeInvoiceUrl: string | null = null;

  if (env.STRIPE_SECRET_KEY && org.stripe_customer_id) {
    const stripeInvoice = await createStripeInvoiceForCustomer(env.STRIPE_SECRET_KEY, org.stripe_customer_id, amountCents, currency, description);
    status = "open";
    stripeInvoiceId = stripeInvoice.id;
    stripeInvoiceUrl = stripeInvoice.hosted_invoice_url ?? null;
  }

  await env.DB!
    .prepare("INSERT INTO invoices (id, org_id, amount_cents, currency, description, status, stripe_invoice_id, stripe_invoice_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, orgId, amountCents, currency, description, status, stripeInvoiceId, stripeInvoiceUrl)
    .run();

  return json({ id, orgId, amountCents, currency, description, status, stripeInvoiceId, stripeInvoiceUrl }, 201);
}

async function createStripeCustomer(request: Request, env: CommercialEnv): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  const body = await request.json<Record<string, unknown>>();
  const orgId = requiredString(body.orgId, "orgId");
  const email = requiredString(body.email, "email");
  const name = requiredString(body.name, "name");

  const stripeCustomer = await stripeFormPost(env.STRIPE_SECRET_KEY, "customers", {
    email,
    name,
    metadata: JSON.stringify({ orgId }),
  });

  await env.DB!
    .prepare("UPDATE organizations SET stripe_customer_id = ? WHERE id = ?")
    .bind(String(stripeCustomer.id), orgId)
    .run();

  return json({ orgId, stripeCustomerId: stripeCustomer.id }, 201);
}

async function createStripeInvoiceForCustomer(
  stripeSecretKey: string,
  stripeCustomerId: string,
  amountCents: number,
  currency: string,
  description: string,
): Promise<{ id: string; hosted_invoice_url?: string | null }> {
  await stripeFormPost(stripeSecretKey, "invoiceitems", {
    customer: stripeCustomerId,
    amount: String(amountCents),
    currency,
    description,
  });

  const invoice = await stripeFormPost(stripeSecretKey, "invoices", {
    customer: stripeCustomerId,
    auto_advance: "true",
    collection_method: "send_invoice",
    days_until_due: "1",
  });

  const finalized = await stripeFormPost(stripeSecretKey, `invoices/${invoice.id}/finalize`, {});
  return {
    id: String(finalized.id),
    hosted_invoice_url: finalized.hosted_invoice_url ? String(finalized.hosted_invoice_url) : null,
  };
}

async function stripeFormPost(secretKey: string, resource: string, payload: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(payload);
  const response = await fetch(`https://api.stripe.com/v1/${resource}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const jsonBody = await response.json<Record<string, unknown>>();
  if (!response.ok)
    throw new Error(`Stripe request failed for ${resource}: ${JSON.stringify(jsonBody)}`);

  return jsonBody;
}

function extractApiKey(request: Request): string | null {
  const headerKey = request.headers.get("x-api-key");
  if (headerKey)
    return headerKey.trim();

  return extractBearer(request);
}

function extractBearer(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader)
    return null;

  const [scheme, token] = authHeader.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token)
    return null;

  return token.trim();
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} is required`);
  return value.trim();
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredInteger(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed))
    throw new Error(`${name} must be a number`);
  return parsed;
}

function arrayOfStrings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${name} must be an array of strings`);
  return value as string[];
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function sha256hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => (byte % 36).toString(36)).join("");
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
