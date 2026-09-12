# Database

**PostgreSQL.** LOCAL for development now; hosted later via a clean data-access layer
(no vendor-specific coupling). Metadata only — never store PDFs/blobs in the DB
(files live in Cloudinary; keys are stored here). Status: **PLANNED** (Phase 3).

## Local dev

```
DATABASE_URL=postgresql://localhost:5432/jdresume
```
Start local Postgres (any local install). No SQLite in the multi-user service.

## Ownership model

Every user-owned row has `owner_id` = `anonymous:<session_id>` or `user:<user_id>`.
Anonymous and authenticated share the model, so login is added later with no redesign.
**Every query filters by owner** (`WHERE id=? AND owner_id=?`); never trust client IDs.

## Tables (initial)

```sql
-- Identity ------------------------------------------------------------------
CREATE TABLE anonymous_sessions (
  id           TEXT PRIMARY KEY,        -- opaque high-entropy id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE TABLE users (                    -- PLANNED (auth phase)
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resumes -------------------------------------------------------------------
CREATE TABLE resumes (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,           -- anonymous:<id> | user:<id>
  title        TEXT,
  original_key TEXT,                    -- Cloudinary key of uploaded original
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_resumes_owner ON resumes(owner_id);

CREATE TABLE resume_versions (          -- immutable
  id             TEXT PRIMARY KEY,
  resume_id      TEXT NOT NULL REFERENCES resumes(id),
  version        INTEGER NOT NULL,
  resume_json    JSONB NOT NULL,        -- canonical ResumeJSON
  schema_version TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(resume_id, version)
);

-- Jobs / analysis -----------------------------------------------------------
CREATE TABLE job_descriptions (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  resume_id  TEXT REFERENCES resumes(id),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE jd_analyses (
  id        TEXT PRIMARY KEY,
  jd_id     TEXT NOT NULL REFERENCES job_descriptions(id),
  result    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE gap_analyses (
  id        TEXT PRIMARY KEY,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id),
  jd_analysis_id    TEXT NOT NULL REFERENCES jd_analyses(id),
  result    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tailored_resumes (         -- a resume_version produced by tailoring
  id             TEXT PRIMARY KEY,
  resume_id      TEXT NOT NULL REFERENCES resumes(id),
  base_version_id TEXT NOT NULL REFERENCES resume_versions(id),
  jd_analysis_id  TEXT REFERENCES jd_analyses(id),
  resume_json    JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Templates -----------------------------------------------------------------
CREATE TABLE templates (
  id          TEXT PRIMARY KEY,         -- 'T01' | 'T02' | 'T03'
  name        TEXT NOT NULL,
  font        TEXT NOT NULL,
  current_version TEXT NOT NULL
);
CREATE TABLE template_versions (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  version     TEXT NOT NULL,
  UNIQUE(template_id, version)
);

-- Compilation / documents ---------------------------------------------------
CREATE TABLE compilation_jobs (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  revision_id  TEXT NOT NULL,
  template_id  TEXT NOT NULL REFERENCES templates(id),
  status       TEXT NOT NULL,           -- queued|compiling|rendering|ready|error
  error_code   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE generated_documents (      -- immutable artifact
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id),
  revision_id      TEXT NOT NULL,
  template_id      TEXT NOT NULL,
  template_version TEXT NOT NULL,
  compiler         TEXT NOT NULL,       -- 'tectonic'
  compiler_version TEXT NOT NULL,       -- '0.17.0'
  sha256           TEXT NOT NULL,
  page_count       INTEGER NOT NULL,
  file_size        INTEGER NOT NULL,
  storage_key      TEXT NOT NULL,       -- private Cloudinary key of the PDF
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ
);
CREATE INDEX idx_docs_owner ON generated_documents(owner_id);

CREATE TABLE preview_pages (
  document_id  TEXT NOT NULL REFERENCES generated_documents(id),
  page         INTEGER NOT NULL,
  storage_key  TEXT NOT NULL,           -- private key of page image
  PRIMARY KEY(document_id, page)
);

-- Exports / usage -----------------------------------------------------------
CREATE TABLE export_tokens (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES generated_documents(id),
  revision_id TEXT NOT NULL,
  token_hash  TEXT NOT NULL,            -- store HASH only, never the raw token
  status      TEXT NOT NULL,            -- issued|consumed|expired
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE TABLE usage (
  owner_id     TEXT NOT NULL,
  date         DATE NOT NULL,
  compiles     INTEGER NOT NULL DEFAULT 0,
  ai_calls     INTEGER NOT NULL DEFAULT 0,
  exports_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id, date)
);
```

## Rules

- Resume versions and generated documents are **immutable**; edits create new rows.
- Store **only the hash** of export tokens; tokens are single-use + short-lived.
- Export consumption must be **atomic** (transaction: check quota → reserve → issue token).
- A failed compile never increments `exports_used`.
- ORM/data-access is a thin layer so hosted Postgres later needs no app changes.
