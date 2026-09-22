-- ══════════════════════════════════════════════════════════════
-- Migration 043: Threat system expansion
--
-- Adds tables for DBSCAN clustering, relabel tracking, and
-- session-level scoring. Core tables (threat_scores,
-- threat_classifications, blocked_ips) were created outside the
-- migration history on the original database; they are defined
-- below (IF NOT EXISTS) so a fresh database replays cleanly.
-- Columns are reconstructed from the app's reads and writes.
-- ══════════════════════════════════════════════════════════════

-- ─── Core threat tables ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.threat_scores (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         TEXT,
  ip_hash            TEXT,
  threat_score       DECIMAL(5,2) NOT NULL,
  classification     TEXT,
  features           JSONB,
  feature_importance JSONB,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_score ON public.threat_scores(threat_score DESC);
CREATE INDEX IF NOT EXISTS idx_ts_created ON public.threat_scores(created_at DESC);
ALTER TABLE public.threat_scores ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.threat_classifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT,
  ip_hash     TEXT,
  attack_type TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'low',
  notes       TEXT,
  labeled_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tcl_session ON public.threat_classifications(session_id, created_at DESC);
ALTER TABLE public.threat_classifications ENABLE ROW LEVEL SECURITY;

-- ip_hash is unique: the cluster cron upserts on it (onConflict: "ip_hash").
CREATE TABLE IF NOT EXISTS public.blocked_ips (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash     TEXT NOT NULL UNIQUE,
  reason      TEXT,
  blocked_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bip_active ON public.blocked_ips(is_active, created_at DESC);
ALTER TABLE public.blocked_ips ENABLE ROW LEVEL SECURITY;

-- ─── threat_clusters: DBSCAN nightly clustering results ─────
CREATE TABLE IF NOT EXISTS public.threat_clusters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id       INTEGER NOT NULL,
  cluster_center   JSONB NOT NULL,          -- mean feature vector
  member_count     INTEGER NOT NULL,
  avg_threat_score DECIMAL(5,2) NOT NULL,
  member_ips       JSONB,                   -- array of ip_hash strings
  auto_blocked     BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tc_score ON public.threat_clusters(avg_threat_score DESC);
CREATE INDEX IF NOT EXISTS idx_tc_created ON public.threat_clusters(created_at DESC);

ALTER TABLE public.threat_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "threat_clusters_admin_read" ON public.threat_clusters
  FOR SELECT USING (user_role() = 'admin');
CREATE POLICY "threat_clusters_service_write" ON public.threat_clusters
  FOR INSERT WITH CHECK (false);  -- service role only

-- ─── threat_label_history: tracks relabels for FP analysis ──
CREATE TABLE IF NOT EXISTS public.threat_label_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     TEXT NOT NULL,
  previous_label TEXT,
  new_label      TEXT NOT NULL,
  relabeled_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason         TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tlh_session ON public.threat_label_history(session_id);
CREATE INDEX IF NOT EXISTS idx_tlh_created ON public.threat_label_history(created_at DESC);

ALTER TABLE public.threat_label_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tlh_admin_read" ON public.threat_label_history
  FOR SELECT USING (user_role() = 'admin');
CREATE POLICY "tlh_service_write" ON public.threat_label_history
  FOR INSERT WITH CHECK (false);  -- service role only

-- ─── session_scores: per-session bot/threat scoring cache ───
CREATE TABLE IF NOT EXISTS public.session_scores (
  session_id     TEXT PRIMARY KEY,
  bot_score      INTEGER CHECK (bot_score >= 0 AND bot_score <= 100),
  classification TEXT CHECK (classification IN ('human', 'suspicious', 'likely_bot', 'bot')),
  reasons        JSONB,
  event_count    INTEGER DEFAULT 0,
  pageview_count INTEGER DEFAULT 0,
  click_count    INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0,  -- seconds
  first_seen     TIMESTAMPTZ,
  last_seen      TIMESTAMPTZ,
  country        TEXT,
  device_type    TEXT,
  browser        TEXT,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.session_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ss_admin_read" ON public.session_scores
  FOR SELECT USING (user_role() = 'admin');
CREATE POLICY "ss_service_write" ON public.session_scores
  FOR ALL USING (false);  -- service role only

-- ─── Tighten existing threat table RLS to admin-only ────────
-- Replace the overly-broad "authenticated" policies with admin-only

DROP POLICY IF EXISTS "Auth manage threat scores" ON public.threat_scores;
CREATE POLICY "threat_scores_admin_read" ON public.threat_scores
  FOR SELECT USING (user_role() = 'admin');
CREATE POLICY "threat_scores_service_write" ON public.threat_scores
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "Auth manage threat classifications" ON public.threat_classifications;
CREATE POLICY "threat_class_admin_read" ON public.threat_classifications
  FOR SELECT USING (user_role() = 'admin');
CREATE POLICY "threat_class_service_write" ON public.threat_classifications
  FOR ALL USING (false);

DROP POLICY IF EXISTS "Auth manage blocked ips" ON public.blocked_ips;
CREATE POLICY "blocked_ips_admin_read" ON public.blocked_ips
  FOR SELECT USING (user_role() = 'admin');
CREATE POLICY "blocked_ips_service_write" ON public.blocked_ips
  FOR ALL USING (false);
