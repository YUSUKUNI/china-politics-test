CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  test_version TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  percentages_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (client_id, test_version)
);

CREATE INDEX idx_results_created_at ON results(created_at);
CREATE INDEX idx_results_version_created_at ON results(test_version, created_at);
