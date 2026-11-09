-- Idempotent schema. Runs on every boot.

CREATE TABLE IF NOT EXISTS admins (
  id             SERIAL PRIMARY KEY,
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quizzes (
  id                SERIAL PRIMARY KEY,
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL DEFAULT '',
  duration_minutes  INT         NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600),
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by        INT         REFERENCES admins(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Show answer options in a different (stable) order for each participant.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS questions (
  id        SERIAL PRIMARY KEY,
  quiz_id   INT  NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position  INT  NOT NULL,
  type      TEXT NOT NULL CHECK (type IN ('single', 'yesno', 'multiple')),
  text      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_quiz_idx ON questions (quiz_id, position);

CREATE TABLE IF NOT EXISTS options (
  id           SERIAL PRIMARY KEY,
  question_id  INT     NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position     INT     NOT NULL,
  text         TEXT    NOT NULL,
  is_correct   BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS options_question_idx ON options (question_id, position);

-- One row per (quiz, participant). Holds the per-person credentials and attempt state.
CREATE TABLE IF NOT EXISTS invitations (
  id              SERIAL PRIMARY KEY,
  quiz_id         INT         NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  name            TEXT        NOT NULL DEFAULT '',
  token           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'in_progress', 'submitted')),
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_status    TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (email_status IN ('pending', 'sent', 'failed', 'not_configured')),
  email_error     TEXT,
  started_at      TIMESTAMPTZ,
  deadline_at     TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  auto_submitted  BOOLEAN     NOT NULL DEFAULT false,
  score           INT,
  max_score       INT,
  UNIQUE (quiz_id, email)
);
-- Only one browser may be signed in to a link: the newest sign-in replaces session_key.
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS session_key TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS sign_in_count INT NOT NULL DEFAULT 0;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS invitations_progress_idx ON invitations (status, deadline_at);

CREATE TABLE IF NOT EXISTS answers (
  invitation_id  INT         NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  question_id    INT         NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_ids     INT[]       NOT NULL DEFAULT '{}',
  is_correct     BOOLEAN,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, question_id)
);

-- What participants see after submitting: 'full' (score + correct answers),
-- 'score' (score only) or 'none' (just a confirmation).
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS show_results TEXT NOT NULL DEFAULT 'full'
  CHECK (show_results IN ('full', 'score', 'none'));

-- The owner (the first admin) is the only one who can add, remove or reset other
-- admins. Without this, any admin could remove another and receive their quizzes.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('owner', 'admin'));
UPDATE admins SET role = 'owner'
WHERE id = (SELECT id FROM admins ORDER BY created_at, id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM admins WHERE role = 'owner');
