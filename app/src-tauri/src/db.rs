//! SQLite storage. Every measurement is written as it arrives; a run is a time interval over measurements.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::model::{Marker, Measurements, Message, Run, RunParameters, RunStatus, Settings};

pub type DbResult<T> = Result<T, rusqlite::Error>;

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: &Path) -> DbResult<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS measurements (
                timestamp INTEGER PRIMARY KEY,
                count INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                conversion_scale REAL NOT NULL,
                conversion_exponent REAL NOT NULL,
                export_path TEXT,
                parameters TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS markers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                timestamp INTEGER NOT NULL,
                label TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                level TEXT NOT NULL,
                text TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                value TEXT NOT NULL
            );",
        )?;
        Ok(Self { connection })
    }

    pub fn insert_measurement(&self, timestamp: i64, count: u32) -> DbResult<()> {
        self.connection.execute(
            "INSERT OR REPLACE INTO measurements (timestamp, count) VALUES (?1, ?2)",
            params![timestamp, count],
        )?;
        Ok(())
    }

    pub fn measurements(&self, from: i64, to: i64) -> DbResult<Measurements> {
        let mut statement = self.connection.prepare_cached(
            "SELECT timestamp, count FROM measurements WHERE timestamp >= ?1 AND timestamp <= ?2 ORDER BY timestamp",
        )?;
        let mut measurements = Measurements::default();
        let rows = statement.query_map(params![from, to], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, u32>(1)?)))?;
        for row in rows {
            let (timestamp, count) = row?;
            measurements.timestamps.push(timestamp);
            measurements.counts.push(count);
        }
        Ok(measurements)
    }

    /// Deletes measurements older than cutoff that do not belong to any run.
    pub fn prune_measurements(&self, cutoff: i64) -> DbResult<usize> {
        self.delete_measurements_outside_runs(i64::MIN, cutoff - 1)
    }

    /// Deletes measurements from `from` to `to` (inclusive) that do not belong to any run.
    pub fn delete_measurements_outside_runs(&self, from: i64, to: i64) -> DbResult<usize> {
        self.connection.execute(
            "DELETE FROM measurements WHERE timestamp >= ?1 AND timestamp <= ?2 AND NOT EXISTS (
                SELECT 1 FROM runs WHERE measurements.timestamp >= runs.started_at
                AND measurements.timestamp <= COALESCE(runs.finished_at, 9223372036854775807))",
            params![from, to],
        )
    }

    pub fn insert_run(&self, started_at: i64, scale: f64, exponent: f64, parameters: &RunParameters) -> DbResult<i64> {
        self.connection.execute(
            "INSERT INTO runs (status, started_at, conversion_scale, conversion_exponent, parameters)
             VALUES ('running', ?1, ?2, ?3, ?4)",
            params![started_at, scale, exponent, serde_json::to_string(parameters).unwrap_or_default()],
        )?;
        Ok(self.connection.last_insert_rowid())
    }

    pub fn update_parameters(&self, id: i64, parameters: &RunParameters) -> DbResult<()> {
        self.connection.execute(
            "UPDATE runs SET parameters = ?2 WHERE id = ?1",
            params![id, serde_json::to_string(parameters).unwrap_or_default()],
        )?;
        Ok(())
    }

    pub fn set_status(&self, id: i64, status: RunStatus, finished_at: Option<i64>) -> DbResult<()> {
        self.connection.execute(
            "UPDATE runs SET status = ?2, finished_at = ?3 WHERE id = ?1",
            params![id, status.as_str(), finished_at],
        )?;
        Ok(())
    }

    pub fn set_export_path(&self, id: i64, path: &str) -> DbResult<()> {
        self.connection.execute("UPDATE runs SET export_path = ?2 WHERE id = ?1", params![id, path])?;
        Ok(())
    }

    pub fn delete_run(&self, id: i64) -> DbResult<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM markers WHERE run_id = ?1", params![id])?;
        transaction.execute("DELETE FROM runs WHERE id = ?1", params![id])?;
        transaction.commit()
    }

    /// Returns sample names of runs that use given run as blank run.
    pub fn runs_using_blank(&self, id: i64) -> DbResult<Vec<String>> {
        let mut statement = self.connection.prepare(
            "SELECT json_extract(parameters, '$.sample') FROM runs WHERE json_extract(parameters, '$.blankRunId') = ?1",
        )?;
        let rows = statement.query_map(params![id], |row| row.get::<_, Option<String>>(0))?;
        rows.map(|row| row.map(Option::unwrap_or_default)).collect()
    }

    fn run_from_row(row: &rusqlite::Row) -> DbResult<Run> {
        let parameters: String = row.get(7)?;
        Ok(Run {
            id: row.get(0)?,
            status: RunStatus::parse(&row.get::<_, String>(1)?),
            started_at: row.get(2)?,
            finished_at: row.get(3)?,
            conversion_scale: row.get(4)?,
            conversion_exponent: row.get(5)?,
            export_path: row.get(6)?,
            parameters: serde_json::from_str(&parameters).unwrap_or_default(),
        })
    }

    const RUN_COLUMNS: &'static str =
        "id, status, started_at, finished_at, conversion_scale, conversion_exponent, export_path, parameters";

    pub fn run(&self, id: i64) -> DbResult<Option<Run>> {
        self.connection
            .query_row(
                &format!("SELECT {} FROM runs WHERE id = ?1", Self::RUN_COLUMNS),
                params![id],
                Self::run_from_row,
            )
            .optional()
    }

    pub fn active_run(&self) -> DbResult<Option<Run>> {
        self.connection
            .query_row(
                &format!("SELECT {} FROM runs WHERE status = 'running' ORDER BY id DESC LIMIT 1", Self::RUN_COLUMNS),
                [],
                Self::run_from_row,
            )
            .optional()
    }

    pub fn runs(&self) -> DbResult<Vec<Run>> {
        let mut statement =
            self.connection.prepare(&format!("SELECT {} FROM runs ORDER BY started_at DESC", Self::RUN_COLUMNS))?;
        let rows = statement.query_map([], Self::run_from_row)?;
        rows.collect()
    }

    pub fn insert_marker(&self, run_id: i64, timestamp: i64, label: &str) -> DbResult<Marker> {
        self.connection.execute(
            "INSERT INTO markers (run_id, timestamp, label) VALUES (?1, ?2, ?3)",
            params![run_id, timestamp, label],
        )?;
        Ok(Marker { id: self.connection.last_insert_rowid(), run_id, timestamp, label: label.into() })
    }

    pub fn delete_markers(&self, run_id: i64, label: &str) -> DbResult<()> {
        self.connection.execute("DELETE FROM markers WHERE run_id = ?1 AND label = ?2", params![run_id, label])?;
        Ok(())
    }

    pub fn markers(&self, run_id: i64) -> DbResult<Vec<Marker>> {
        let mut statement = self
            .connection
            .prepare("SELECT id, run_id, timestamp, label FROM markers WHERE run_id = ?1 ORDER BY timestamp")?;
        let rows = statement.query_map(params![run_id], |row| {
            Ok(Marker { id: row.get(0)?, run_id: row.get(1)?, timestamp: row.get(2)?, label: row.get(3)? })
        })?;
        rows.collect()
    }

    pub fn insert_message(&self, timestamp: i64, level: &str, text: &str) -> DbResult<Message> {
        self.connection.execute(
            "INSERT INTO messages (timestamp, level, text) VALUES (?1, ?2, ?3)",
            params![timestamp, level, text],
        )?;
        Ok(Message { id: self.connection.last_insert_rowid(), timestamp, level: level.into(), text: text.into() })
    }

    pub fn recent_messages(&self, limit: u32) -> DbResult<Vec<Message>> {
        let mut statement =
            self.connection.prepare("SELECT id, timestamp, level, text FROM messages ORDER BY id DESC LIMIT ?1")?;
        let rows = statement.query_map(params![limit], |row| {
            Ok(Message { id: row.get(0)?, timestamp: row.get(1)?, level: row.get(2)?, text: row.get(3)? })
        })?;
        let mut messages: Vec<Message> = rows.collect::<DbResult<_>>()?;
        messages.reverse();
        Ok(messages)
    }

    pub fn settings(&self) -> DbResult<Settings> {
        let value: Option<String> =
            self.connection.query_row("SELECT value FROM settings WHERE id = 1", [], |row| row.get(0)).optional()?;
        Ok(value.and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &Settings) -> DbResult<()> {
        self.connection.execute(
            "INSERT OR REPLACE INTO settings (id, value) VALUES (1, ?1)",
            params![serde_json::to_string(settings).unwrap_or_default()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_survives_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.db");
        {
            let database = Database::open(&path).unwrap();
            let parameters = RunParameters { sample: "Na-ZY".into(), mass_g: 0.56, ..Default::default() };
            database.insert_run(1000, 1785.9, 0.0111, &parameters).unwrap();
            database.insert_measurement(1500, 120).unwrap();
        }
        let database = Database::open(&path).unwrap();
        let run = database.active_run().unwrap().unwrap();
        assert_eq!(run.parameters.sample, "Na-ZY");
        assert_eq!(database.measurements(0, 2000).unwrap().counts, vec![120]);
    }

    #[test]
    fn prune_keeps_run_measurements() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.db")).unwrap();
        let run_id = database.insert_run(1000, 1785.9, 0.0111, &RunParameters::default()).unwrap();
        database.set_status(run_id, RunStatus::Finished, Some(2000)).unwrap();
        for timestamp in [500, 1500, 2500] {
            database.insert_measurement(timestamp, 100).unwrap();
        }
        database.prune_measurements(3000).unwrap();
        assert_eq!(database.measurements(0, 3000).unwrap().timestamps, vec![1500]);
    }

    #[test]
    fn clear_keeps_run_measurements() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.db")).unwrap();
        let run_id = database.insert_run(1000, 1785.9, 0.0111, &RunParameters::default()).unwrap();
        database.set_status(run_id, RunStatus::Finished, Some(2000)).unwrap();
        for timestamp in [500, 1500, 2500, 3500] {
            database.insert_measurement(timestamp, 100).unwrap();
        }
        assert_eq!(database.delete_measurements_outside_runs(1000, 3000).unwrap(), 1);
        assert_eq!(database.measurements(0, 4000).unwrap().timestamps, vec![500, 1500, 3500]);
    }

    #[test]
    fn finds_runs_using_blank() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.db")).unwrap();
        let blank = database.insert_run(1000, 1785.9, 0.0111, &RunParameters::default()).unwrap();
        let parameters = RunParameters { sample: "Na-ZY".into(), blank_run_id: Some(blank), ..Default::default() };
        database.insert_run(2000, 1785.9, 0.0111, &parameters).unwrap();
        assert_eq!(database.runs_using_blank(blank).unwrap(), vec!["Na-ZY".to_string()]);
        database.delete_markers(blank, "Valve open").unwrap();
    }
}
