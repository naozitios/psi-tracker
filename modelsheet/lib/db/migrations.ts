// Schema changes, applied in order at startup. Never edit a shipped
// migration; add a new one.
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE models (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cik text NOT NULL,
        ticker text NOT NULL,
        company_name text NOT NULL,
        workbook jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX models_user_idx ON models (user_id, updated_at DESC);

      -- Every accepted change, so it can be shown, audited and undone.
      CREATE TABLE model_edits (
        id bigserial PRIMARY KEY,
        model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        version integer NOT NULL,
        author text NOT NULL CHECK (author IN ('you', 'assistant')),
        summary text NOT NULL,
        edits jsonb NOT NULL,
        reverted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX model_edits_model_idx ON model_edits (model_id, id);

      -- Changes the assistant suggested; applied only when the user accepts.
      CREATE TABLE proposals (
        id uuid PRIMARY KEY,
        model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        base_version integer NOT NULL,
        summary text NOT NULL,
        edits jsonb NOT NULL,
        preview jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
        created_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz
      );
      CREATE INDEX proposals_model_idx ON proposals (model_id, created_at DESC);

      CREATE TABLE chat_messages (
        id bigserial PRIMARY KEY,
        model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('user', 'assistant', 'note')),
        text text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX chat_messages_model_idx ON chat_messages (model_id, id);

      -- Product analytics for the PRD's success metrics.
      CREATE TABLE events (
        id bigserial PRIMARY KEY,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        model_id uuid,
        name text NOT NULL,
        props jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX events_name_idx ON events (name, created_at);

      -- Fixed-window counters shared by every server instance.
      CREATE TABLE rate_limits (
        key text NOT NULL,
        window_start timestamptz NOT NULL,
        count integer NOT NULL,
        PRIMARY KEY (key, window_start)
      );

      -- SEC responses, shared across instances so each company is fetched once.
      CREATE TABLE sec_cache (
        url text PRIMARY KEY,
        body text NOT NULL,
        fetched_at timestamptz NOT NULL
      );
    `,
  },
];
