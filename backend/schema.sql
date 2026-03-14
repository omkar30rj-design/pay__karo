-- PAY KARO — PostgreSQL Database Schema
-- Run: psql -U postgres -d paykaro -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── USERS ──────────────────────────────────────────────────────────
CREATE TABLE users (
  uid          VARCHAR(128) PRIMARY KEY,
  phone        VARCHAR(15)  UNIQUE NOT NULL,
  name         VARCHAR(100),
  upi_id       VARCHAR(100) UNIQUE,
  bank_code    VARCHAR(20),
  avatar_url   TEXT,
  device_token TEXT,
  green_score  DECIMAL(5,2)  DEFAULT 0,
  green_grade  VARCHAR(2)    DEFAULT 'B',
  is_new_user  BOOLEAN       DEFAULT TRUE,
  kyc_verified BOOLEAN       DEFAULT FALSE,
  last_login   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_phone  ON users(phone);
CREATE INDEX idx_users_upi_id ON users(upi_id);

-- ── TRANSACTIONS ────────────────────────────────────────────────────
CREATE TYPE txn_status   AS ENUM ('pending','success','failed','refunded');
CREATE TYPE txn_type     AS ENUM ('debit','credit');
CREATE TYPE txn_category AS ENUM ('food','travel','shopping','bills','entertainment','other');

CREATE TABLE transactions (
  id           VARCHAR(50)  PRIMARY KEY,
  uid          VARCHAR(128) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  to_upi_id    VARCHAR(100) NOT NULL,
  to_name      VARCHAR(100),
  amount       DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  type         txn_type     NOT NULL DEFAULT 'debit',
  category     txn_category DEFAULT 'other',
  status       txn_status   NOT NULL DEFAULT 'pending',
  upi_ref_id   VARCHAR(50),
  merchant_mcc VARCHAR(4),
  co2_kg       DECIMAL(8,4)  DEFAULT 0,
  note         VARCHAR(200),
  split_id     UUID          REFERENCES splits(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_txn_uid       ON transactions(uid);
CREATE INDEX idx_txn_uid_month ON transactions(uid, DATE_TRUNC('month', created_at));
CREATE INDEX idx_txn_category  ON transactions(category);
CREATE INDEX idx_txn_created   ON transactions(created_at DESC);

-- ── SPLITS ──────────────────────────────────────────────────────────
CREATE TYPE split_status AS ENUM ('active','settled','cancelled');
CREATE TYPE split_type   AS ENUM ('equal','custom','percentage');

CREATE TABLE splits (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by_uid  VARCHAR(128) NOT NULL REFERENCES users(uid),
  title           VARCHAR(100) NOT NULL,
  total_amount    DECIMAL(12,2) NOT NULL,
  split_type      split_type   NOT NULL DEFAULT 'equal',
  category        txn_category,
  note            VARCHAR(200),
  status          split_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  settled_at      TIMESTAMPTZ
);

CREATE TABLE split_participants (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  split_id     UUID         NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  uid          VARCHAR(128) REFERENCES users(uid) ON DELETE SET NULL,
  upi_id       VARCHAR(100) NOT NULL,
  name         VARCHAR(100) NOT NULL,
  share_amount DECIMAL(10,2) NOT NULL,
  has_paid     BOOLEAN       NOT NULL DEFAULT FALSE,
  txn_id       VARCHAR(50)   REFERENCES transactions(id) ON DELETE SET NULL,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_split_creator    ON splits(created_by_uid);
CREATE INDEX idx_split_part_uid   ON split_participants(uid);
CREATE INDEX idx_split_part_split ON split_participants(split_id);

-- ── GROUPS ──────────────────────────────────────────────────────────
CREATE TYPE group_type AS ENUM ('friends','roommates','office','travel','other');

CREATE TABLE groups (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           VARCHAR(100) NOT NULL,
  type           group_type   NOT NULL DEFAULT 'friends',
  emoji          VARCHAR(8)   DEFAULT '👥',
  created_by_uid VARCHAR(128) NOT NULL REFERENCES users(uid),
  total_pending  DECIMAL(12,2) DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
  group_id  UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  uid       VARCHAR(128) REFERENCES users(uid) ON DELETE CASCADE,
  upi_id    VARCHAR(100) NOT NULL,
  role      VARCHAR(20)  DEFAULT 'member',
  joined_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, upi_id)
);

-- ── SPENDING INSIGHTS ───────────────────────────────────────────────
CREATE TABLE spending_insights (
  uid                VARCHAR(128)  NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  month              VARCHAR(7)    NOT NULL,   -- 'YYYY-MM'
  total_spent        DECIMAL(12,2) DEFAULT 0,
  total_budget       DECIMAL(12,2) DEFAULT 30000,
  category_breakdown JSONB         DEFAULT '{}',
  category_budgets   JSONB         DEFAULT '{}',
  total_co2_kg       DECIMAL(8,4)  DEFAULT 0,
  green_score        DECIMAL(5,2)  DEFAULT 0,
  green_grade        VARCHAR(2)    DEFAULT 'B',
  alerts             JSONB         DEFAULT '[]',
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (uid, month)
);
CREATE INDEX idx_insight_uid   ON spending_insights(uid);
CREATE INDEX idx_insight_month ON spending_insights(month);

-- ── SAVED CONTACTS ──────────────────────────────────────────────────
CREATE TABLE saved_contacts (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  uid             VARCHAR(128) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  contact_upi_id  VARCHAR(100) NOT NULL,
  contact_name    VARCHAR(100) NOT NULL,
  nickname        VARCHAR(50),
  txn_count       INT          DEFAULT 0,
  last_txn_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (uid, contact_upi_id)
);

-- ── BUDGET SETTINGS ─────────────────────────────────────────────────
CREATE TABLE budget_settings (
  uid              VARCHAR(128)  PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  monthly_budget   DECIMAL(12,2) DEFAULT 30000,
  category_budgets JSONB         DEFAULT '{}',
  alert_threshold  DECIMAL(5,2)  DEFAULT 0.75,
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── NOTIFICATIONS LOG ───────────────────────────────────────────────
CREATE TABLE notifications (
  id      UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  uid     VARCHAR(128) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  type    VARCHAR(50)  NOT NULL,
  title   VARCHAR(200) NOT NULL,
  body    TEXT,
  data    JSONB,
  is_read BOOLEAN      DEFAULT FALSE,
  sent_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notif_uid ON notifications(uid);

-- ── TRIGGERS ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ language 'plpgsql';

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_budget_updated_at
  BEFORE UPDATE ON budget_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── VIEWS ────────────────────────────────────────────────────────────

-- Monthly category spending per user
CREATE VIEW v_monthly_spending AS
SELECT uid, TO_CHAR(created_at, 'YYYY-MM') AS month, category,
  COUNT(*) AS txn_count, SUM(amount) AS total_amount, SUM(co2_kg) AS total_co2_kg
FROM transactions WHERE status = 'success' AND type = 'debit'
GROUP BY uid, TO_CHAR(created_at, 'YYYY-MM'), category;

-- Who owes whom (peer debts via splits)
CREATE VIEW v_peer_debts AS
SELECT s.created_by_uid AS creditor_uid, sp.uid AS debtor_uid,
  sp.upi_id AS debtor_upi, sp.name AS debtor_name,
  SUM(sp.share_amount) AS total_owed, COUNT(*) AS split_count
FROM splits s
JOIN split_participants sp ON sp.split_id = s.id
WHERE sp.has_paid = FALSE AND s.status = 'active' AND sp.uid IS NOT NULL
GROUP BY s.created_by_uid, sp.uid, sp.upi_id, sp.name;

-- Dev seed data (uncomment to use)
-- INSERT INTO users (uid, phone, name, upi_id, green_score, green_grade) VALUES
--   ('dev_001', '+919876543210', 'Arjun Sharma', 'arjun@paykaro', 72, 'B+'),
--   ('dev_002', '+919876543211', 'Rahul Kumar',  'rahul@paykaro', 58, 'B'),
--   ('dev_003', '+919876543212', 'Priya Menon',  'priya@paykaro', 85, 'A');
