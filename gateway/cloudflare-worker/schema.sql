CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  routes_json TEXT NOT NULL,
  limits_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  billing_email TEXT,
  plan_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(org_id);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  api_key_id TEXT,
  route_id TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_created ON usage_events(org_id, created_at);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  stripe_invoice_id TEXT,
  stripe_invoice_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

