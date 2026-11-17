CREATE TABLE survey30_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  survey_version TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (client_id, survey_version)
);

CREATE INDEX idx_survey30_results_created_at
ON survey30_results(created_at);

CREATE INDEX idx_survey30_results_version_created_at
ON survey30_results(survey_version, created_at);
