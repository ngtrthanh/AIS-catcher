# AIS-catcher API Gateway

This is a Cloudflare Worker starter that sits in front of an `AIS-catcher` instance running in backend-only mode.

## Purpose

- expose a clean `/v1/*` public API
- authenticate callers with API keys
- assign each key to a tier
- allow or deny routes per tier
- add per-tier cache and delay behavior
- keep the raw `AIS-catcher` origin private

## Recommended AIS-catcher origin mode

Run AIS-catcher with only the backend routes you need:

```txt
-N 8100 API_ONLY on CORS off API_FRONTEND off API_STATS on API_SHIPS on API_STREAM on API_PATHS on API_HISTORY on API_VESSEL on API_DECODE off
```

The Worker should be the only public entrypoint. Cloudflare Pages can call the Worker, not the AIS-catcher origin directly.

## Public routes

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

## Config model

You provide:

- `AIS_API_BASE_URL`
- `ALLOWED_ORIGINS`
- `TIER_CONFIG_JSON`
- `API_KEYS_JSON`

Use [config.example.json](./config.example.json) as the source shape for the last two values.

## Auth

The Worker accepts either:

- `Authorization: Bearer <api-key>`
- `x-api-key: <api-key>`

## Per-tier controls

Each tier can define:

- `allowedRoutes`
- `cacheTtlSeconds`
- `artificialDelayMs`

This starter does not include persistent quota/rate-limit storage. For production tiers, add:

- Cloudflare Durable Objects
- Cloudflare KV plus scheduled aggregation
- a dedicated external rate-limit store

## Local dev

```bash
cd gateway/cloudflare-worker
npm install
npm run dev
```

Set local secrets/vars with Wrangler before deploying.

## Cloudflare Pages frontend pattern

Frontend:

- hosted on Pages
- calls the Worker under `/api/*` or a dedicated subdomain

Gateway:

- validates key or session
- rewrites to the internal AIS-catcher origin
- filters access by tier
- returns normalized JSON

Backend:

- AIS-catcher only
- private network origin

