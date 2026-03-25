# AIS-catcher Commercial API Gateway

This Worker is the commercial API layer for an `AIS-catcher` backend running in API-only mode.

It gives you:

- public `/v1/*` routes for customers
- per-customer API keys
- plan-based endpoint access
- usage logging in Cloudflare D1
- admin endpoints for issuing keys and invoices
- optional Stripe invoice creation

## Backend mode

Run `AIS-catcher` as a private backend origin:

```txt
-N 8100 API_ONLY on CORS off API_FRONTEND off API_STATS on API_SHIPS on API_STREAM on API_PATHS on API_HISTORY on API_VESSEL on API_DECODE off
```

The Worker should be the only public entrypoint. Do not expose the raw `AIS-catcher` origin to customers.

## Public API routes

- `GET /v1/stats`
- `GET /v1/ships`
- `GET /v1/ships/compact`
- `GET /v1/ships/full`
- `GET /v1/ships/:mmsi`
- `GET /v1/paths`
- `GET /v1/paths/:mmsi`
- `GET /v1/history`
- `GET /v1/stream`
- `GET /v1/signal-stream`
- `GET /v1/messages/:mmsi`
- `POST /v1/decode`

## Commercial control plane

Admin routes are served directly by the Worker and require:

```txt
Authorization: Bearer <ADMIN_API_TOKEN>
```

Available admin routes:

- `GET /admin/plans`
- `POST /admin/plans`
- `GET /admin/orgs`
- `POST /admin/orgs`
- `GET /admin/api-keys?orgId=<id>`
- `POST /admin/api-keys`
- `GET /admin/usage?orgId=<id>&from=<iso>&to=<iso>`
- `GET /admin/invoices?orgId=<id>`
- `POST /admin/invoices`
- `POST /admin/stripe/customers`

## Database

Apply the schema in [schema.sql](./schema.sql) to a Cloudflare D1 database.

Tables:

- `plans`
- `organizations`
- `api_keys`
- `usage_events`
- `invoices`

`api_keys` only stores a prefix and a SHA-256 hash of the secret. The raw issued key is returned once when created.

## Tomorrow-ready commercial flow

1. Create a D1 database and apply `schema.sql`.
2. Deploy the Worker with `DB`, `ADMIN_API_TOKEN`, and `AIS_API_BASE_URL`.
3. Create a plan:

```bash
curl -X POST "$GATEWAY_URL/admin/plans" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "pro-monthly",
    "name": "Pro Monthly",
    "priceCents": 4900,
    "currency": "usd",
    "allowedRoutes": ["stats", "ships", "ship_detail", "paths", "path_detail", "history", "stream"],
    "limits": { "cacheTtlSeconds": 0, "artificialDelayMs": 0 }
  }'
```

4. Create the customer organization:

```bash
curl -X POST "$GATEWAY_URL/admin/orgs" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer A",
    "billingEmail": "ops@example.com",
    "planId": "pro-monthly"
  }'
```

5. Optionally create the Stripe customer:

```bash
curl -X POST "$GATEWAY_URL/admin/stripe/customers" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "<org-id>",
    "name": "Customer A",
    "email": "ops@example.com"
  }'
```

6. Issue the API key:

```bash
curl -X POST "$GATEWAY_URL/admin/api-keys" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "<org-id>",
    "name": "production-key"
  }'
```

7. Give the returned `issuedKey` to the customer.
8. Pull usage with `/admin/usage`.
9. Create an invoice:

```bash
curl -X POST "$GATEWAY_URL/admin/invoices" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "<org-id>",
    "amountCents": 4900,
    "currency": "usd",
    "description": "AIS API Pro Monthly"
  }'
```

If `STRIPE_SECRET_KEY` is configured and the org has a Stripe customer id, the Worker creates and finalizes a Stripe invoice. Otherwise it stores a local draft invoice record in D1.

## Auth for customer traffic

The public gateway accepts either:

- `Authorization: Bearer <issued-key>`
- `x-api-key: <issued-key>`

Issued key format:

```txt
ais_xxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

## Config modes

The Worker supports two modes:

- commercial mode: D1-backed customers and admin APIs
- starter mode: `TIER_CONFIG_JSON` and `API_KEYS_JSON` from environment vars

If `DB` is configured, the Worker tries commercial auth first and falls back to the JSON config only when no D1 key matches.

## Secrets and variables

Required:

- `AIS_API_BASE_URL`
- `ALLOWED_ORIGINS`
- `ADMIN_API_TOKEN`

Commercial mode:

- D1 binding `DB`
- `STRIPE_SECRET_KEY` if you want Stripe invoice/customer creation

Starter mode fallback:

- `TIER_CONFIG_JSON`
- `API_KEYS_JSON`

## Local dev

```bash
cd gateway/cloudflare-worker
npm install
npx wrangler d1 execute ais-catcher-gateway --local --file=./schema.sql
npm run dev
```

## Deploy

Simple local deploy:

```bash
cd gateway/cloudflare-worker
npm install
npm run deploy
```

GitHub Actions deploy requires these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `AIS_API_BASE_URL`
- `ALLOWED_ORIGINS`
- `ADMIN_API_TOKEN`
- `STRIPE_SECRET_KEY` if used

## Cloudflare Pages pattern

- Pages hosts your frontend or customer portal
- the Worker is your public API and admin surface
- `AIS-catcher` stays private behind the Worker

That gives you a clean split between ingestion, commercial policy, and billing.
