//! SQLite storage. Every measurement is written as it arrives; a run is a time interval over measurements.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::calculation::Series;
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
            );
            CREATE TABLE IF NOT EXISTS run_data (
                run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                time_s REAL NOT NULL,
                value_ppm REAL NOT NULL,
                raw_signal REAL,
                PRIMARY KEY (run_id, position)
            );
            CREATE TABLE IF NOT EXISTS sample (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                value TEXT NOT NULL
            );",
        )?;
        // Order of runs in History, highest first; databases of earlier versions get order by start time
        let has_order: bool = connection.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('runs') WHERE name = 'sort_order'",
            [],
            |row| row.get(0),
        )?;
        if !has_order {
            connection.execute_batch(
                "ALTER TABLE runs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
                 UPDATE runs SET sort_order = (SELECT COUNT(*) FROM runs AS earlier WHERE earlier.started_at <= runs.started_at);",
            )?;
        }
        // Raw signal of edited data, added in version 1.0.1; earlier edited data has CO2 values only
        let has_raw_signal: bool = connection.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('run_data') WHERE name = 'raw_signal'",
            [],
            |row| row.get(0),
        )?;
        if !has_raw_signal {
            connection.execute_batch("ALTER TABLE run_data ADD COLUMN raw_signal REAL;")?;
        }
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
            "INSERT INTO runs (status, started_at, conversion_scale, conversion_exponent, parameters, sort_order)
             VALUES ('running', ?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM runs))",
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
        transaction.execute("DELETE FROM run_data WHERE run_id = ?1", params![id])?;
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
            edited: row.get(8)?,
        })
    }

    const RUN_COLUMNS: &'static str = "id, status, started_at, finished_at, conversion_scale, conversion_exponent, \
        export_path, parameters, EXISTS (SELECT 1 FROM run_data WHERE run_data.run_id = runs.id)";

    /// Sets order of runs in History; ids are in order from top to bottom.
    pub fn reorder_runs(&self, ids: &[i64]) -> DbResult<()> {
        let transaction = self.connection.unchecked_transaction()?;
        for (index, id) in ids.iter().enumerate() {
            transaction
                .execute("UPDATE runs SET sort_order = ?1 WHERE id = ?2", params![(ids.len() - index) as i64, id])?;
        }
        transaction.commit()
    }

    /// Edited data of run, or None when run uses measurements.
    /// Edited data of run, and raw signal when every row has one.
    pub fn run_data(&self, run_id: i64) -> DbResult<Option<(Series, Option<Vec<f64>>)>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT time_s, value_ppm, raw_signal FROM run_data WHERE run_id = ?1 ORDER BY position",
        )?;
        let rows = statement.query_map(params![run_id], |row| {
            Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, Option<f64>>(2)?))
        })?;
        let mut series = Series::default();
        let mut counts = Some(Vec::new());
        for row in rows {
            let (time, value, count) = row?;
            series.times.push(time);
            series.concentrations.push(value);
            match (&mut counts, count) {
                (Some(list), Some(count)) => list.push(count),
                _ => counts = None,
            }
        }
        Ok(if series.times.is_empty() { None } else { Some((series, counts)) })
    }

    /// Replaces edited data of run; counts are raw signal of rows.
    pub fn save_run_data(&self, run_id: i64, series: &Series, counts: &[f64]) -> DbResult<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM run_data WHERE run_id = ?1", params![run_id])?;
        {
            let mut statement = transaction.prepare(
                "INSERT INTO run_data (run_id, position, time_s, value_ppm, raw_signal) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for (position, ((time, value), count)) in
                series.times.iter().zip(&series.concentrations).zip(counts).enumerate()
            {
                statement.execute(params![run_id, position as i64, time, value, count])?;
            }
        }
        transaction.commit()
    }

    /// Removes edited data; run uses measurements again.
    pub fn delete_run_data(&self, run_id: i64) -> DbResult<()> {
        self.connection.execute("DELETE FROM run_data WHERE run_id = ?1", params![run_id])?;
        Ok(())
    }

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
        let mut statement = self
            .connection
            .prepare(&format!("SELECT {} FROM runs ORDER BY sort_order DESC, started_at DESC", Self::RUN_COLUMNS))?;
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

    pub fn clear_messages(&self) -> DbResult<()> {
        self.connection.execute("DELETE FROM messages", [])?;
        Ok(())
    }

    pub fn delete_message(&self, id: i64) -> DbResult<()> {
        self.connection.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        Ok(())
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

    /// Sample for next run, configured before Start.
    pub fn sample(&self) -> DbResult<Option<RunParameters>> {
        let value: Option<String> =
            self.connection.query_row("SELECT value FROM sample WHERE id = 1", [], |row| row.get(0)).optional()?;
        Ok(value.and_then(|text| serde_json::from_str(&text).ok()))
    }

    pub fn save_sample(&self, parameters: &RunParameters) -> DbResult<()> {
        self.connection.execute(
            "INSERT OR REPLACE INTO sample (id, value) VALUES (1, ?1)",
            params![serde_json::to_string(parameters).unwrap_or_default()],
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
    fn edited_data_replaces_and_restores() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.db")).unwrap();
        let id = database.insert_run(1000, 1785.9, 0.0111, &RunParameters::default()).unwrap();
        assert!(database.run_data(id).unwrap().is_none());
        assert!(!database.run(id).unwrap().unwrap().edited);
        let series = Series { times: vec![1.0, 2.0], concentrations: vec![2500.0, 2600.0] };
        database.save_run_data(id, &series, &[70.0, 71.0]).unwrap();
        let (saved, counts) = database.run_data(id).unwrap().unwrap();
        assert_eq!(saved.concentrations, vec![2500.0, 2600.0]);
        assert_eq!(counts, Some(vec![70.0, 71.0]));
        assert!(database.run(id).unwrap().unwrap().edited);
        database.delete_run_data(id).unwrap();
        assert!(database.run_data(id).unwrap().is_none());
    }

    #[test]
    fn new_run_on_top_and_reorder() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.db")).unwrap();
        let first = database.insert_run(1000, 1785.9, 0.0111, &RunParameters::default()).unwrap();
        let second = database.insert_run(2000, 1785.9, 0.0111, &RunParameters::default()).unwrap();
        let order = |database: &Database| database.runs().unwrap().iter().map(|run| run.id).collect::<Vec<_>>();
        assert_eq!(order(&database), vec![second, first]);
        database.reorder_runs(&[first, second]).unwrap();
        assert_eq!(order(&database), vec![first, second]);
        let third = database.insert_run(500, 1785.9, 0.0111, &RunParameters::default()).unwrap();
        assert_eq!(order(&database), vec![third, first, second]);
    }

    #[test]
    fn database_of_earlier_version_gets_order_by_start() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.db");
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, started_at INTEGER NOT NULL,
                     finished_at INTEGER, conversion_scale REAL NOT NULL, conversion_exponent REAL NOT NULL, export_path TEXT,
                     parameters TEXT NOT NULL);
                     INSERT INTO runs (status, started_at, conversion_scale, conversion_exponent, parameters)
                     VALUES ('finished', 2000, 1785.9, 0.0111, '{}'), ('finished', 1000, 1785.9, 0.0111, '{}');",
                )
                .unwrap();
        }
        let database = Database::open(&path).unwrap();
        let starts: Vec<i64> = database.runs().unwrap().iter().map(|run| run.started_at).collect();
        assert_eq!(starts, vec![2000, 1000]);
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
