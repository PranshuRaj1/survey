CREATE TABLE users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE surveys (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL DEFAULT 'Untitled survey',
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'published', 'closed')),
  brand_color  TEXT NOT NULL DEFAULT '#6366f1',
  logo_url     TEXT,
  font_family  TEXT NOT NULL DEFAULT 'Inter',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE questions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  survey_id   TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (
                type IN ('short_text', 'long_text', 'multiple_choice', 'rating', 'date')
              ),
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  required    INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE responses (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  survey_id      TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  respondent_ip  TEXT,
  submitted_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE response_answers (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  value_json  TEXT NOT NULL
);

-- Hot path
CREATE UNIQUE INDEX idx_surveys_slug         ON surveys(slug);
CREATE INDEX        idx_surveys_owner        ON surveys(owner_id, created_at DESC);
CREATE INDEX        idx_questions_survey     ON questions(survey_id, sort_order);
CREATE INDEX        idx_responses_survey     ON responses(survey_id, submitted_at DESC);
CREATE INDEX        idx_answers_response     ON response_answers(response_id);

-- Analytics
CREATE INDEX        idx_answers_question     ON response_answers(question_id);