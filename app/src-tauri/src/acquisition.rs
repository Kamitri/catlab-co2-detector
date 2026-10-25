//! Serial acquisition loop: finds detector on any serial port, polls once per second (see Timing),
//! reconnects after disconnection. Runs on separate thread, independent of UI.

use std::io::ErrorKind;
use std::panic::{self, AssertUnwindSafe};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serialport::{ClearBuffer, DataBits, FlowControl, Parity, SerialPort, StopBits};

use crate::model::Connection;
use crate::protocol::{FrameError, REQUEST, find_reply};

pub const BAUD_RATE: u32 = 19200;
/// Polls per port during scan. Some USB serial adapters lose first frame after port opens.
const PROBE_ATTEMPTS: u32 = 3;
/// Consecutive missing replies before port is treated as disconnected.
const MAX_MISSED_REPLIES: u32 = 3;
/// Read timeout of serial port; poll() repeats reads until reply timeout.
const READ_TIMEOUT: Duration = Duration::from_millis(10);

/// Timing of acquisition loop. Default is timing of detector; tests use shorter intervals.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub poll_interval: Duration,
    pub scan_interval: Duration,
    pub reply_timeout: Duration,
    /// Wait after opening port before first poll, for adapter to apply line settings.
    pub open_settle: Duration,
    /// Searching time before "Detector not found" message.
    pub not_found_delay: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(1),
            scan_interval: Duration::from_secs(2),
            reply_timeout: Duration::from_millis(900),
            open_settle: Duration::from_millis(200),
            not_found_delay: Duration::from_secs(10),
        }
    }
}

impl Timing {
    /// Timing scaled to poll interval, for simulator and tests.
    pub fn fast(poll_interval: Duration) -> Self {
        Self {
            poll_interval,
            scan_interval: poll_interval * 2,
            reply_timeout: (poll_interval * 4).min(Duration::from_millis(900)),
            open_settle: poll_interval / 2,
            not_found_delay: poll_interval * 15,
        }
    }

    /// Debug builds only: CO2_POLL_INTERVAL_MS sets fast timing for end-to-end test. Release builds ignore it.
    pub fn from_environment() -> Self {
        let interval = std::env::var("CO2_POLL_INTERVAL_MS").ok().and_then(|value| value.parse::<u64>().ok());
        match interval {
            Some(milliseconds) if cfg!(debug_assertions) && milliseconds > 0 => {
                Self::fast(Duration::from_millis(milliseconds))
            }
            _ => Self::default(),
        }
    }
}

pub trait Sink: Send + Sync + 'static {
    fn measurement(&self, timestamp: i64, count: u32);
    fn connection(&self, connection: Connection);
    fn message(&self, level: &str, text: &str);
    /// Extra port names to scan, in addition to system ports.
    fn extra_ports(&self) -> Vec<String>;
}

#[derive(Debug)]
enum PollError {
    NoReply,
    Invalid,
    Port,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as i64).unwrap_or(0)
}

fn open(name: &str) -> serialport::Result<Box<dyn SerialPort>> {
    serialport::new(name, BAUD_RATE)
        .data_bits(DataBits::Eight)
        .stop_bits(StopBits::One)
        .parity(Parity::None)
        .flow_control(FlowControl::None)
        .timeout(READ_TIMEOUT)
        .open()
}

fn poll(port: &mut dyn SerialPort, reply_timeout: Duration) -> Result<u32, PollError> {
    port.clear(ClearBuffer::Input).map_err(|_| PollError::Port)?;
    port.write_all(&REQUEST).map_err(|_| PollError::Port)?;
    port.flush().map_err(|_| PollError::Port)?;
    let deadline = Instant::now() + reply_timeout;
    let mut buffer = Vec::with_capacity(32);
    let mut chunk = [0u8; 32];
    let mut last_error = None;
    while Instant::now() < deadline {
        match port.read(&mut chunk) {
            Ok(0) => thread::sleep(READ_TIMEOUT),
            Ok(length) => {
                buffer.extend_from_slice(&chunk[..length]);
                match find_reply(&buffer) {
                    Ok(count) => return Ok(count),
                    Err(FrameError::Incomplete) => {}
                    Err(_) => last_error = Some(()),
                }
            }
            Err(error) if error.kind() == ErrorKind::TimedOut || error.kind() == ErrorKind::Interrupted => {}
            Err(_) => return Err(PollError::Port),
        }
    }
    Err(if last_error.is_some() { PollError::Invalid } else { PollError::NoReply })
}

fn candidate_ports(extra: Vec<String>, preferred: Option<&str>) -> Vec<String> {
    let mut ports: Vec<String> = serialport::available_ports()
        .map(|list| list.into_iter().map(|info| info.port_name).collect())
        .unwrap_or_default();
    for name in extra {
        if !ports.contains(&name) {
            ports.push(name);
        }
    }
    if let Some(preferred) = preferred
        && let Some(index) = ports.iter().position(|name| name == preferred)
    {
        let name = ports.remove(index);
        ports.insert(0, name);
    }
    ports
}

/// Port found by scan, with first count N.
type Found = (String, Box<dyn SerialPort>, u32);

/// Describes why port could not be opened.
fn open_failure(error: &serialport::Error) -> &'static str {
    let description = error.description.to_lowercase();
    // Windows reports port opened by another program as "Access is denied", Linux as "busy"
    if description.contains("denied") || description.contains("busy") { "in use" } else { "cannot open" }
}

/// Opens each candidate port and returns first port that replies with valid frame.
/// Without detector, returns result of each port, for example "COM3: in use".
fn scan(sink: &dyn Sink, preferred: Option<&str>, timing: &Timing, stop: &AtomicBool) -> Result<Found, Vec<String>> {
    let mut results = Vec::new();
    for name in candidate_ports(sink.extra_ports(), preferred) {
        let mut port = match open(&name) {
            Ok(port) => port,
            Err(error) => {
                results.push(format!("{name}: {}", open_failure(&error)));
                continue;
            }
        };
        sleep_until(Instant::now() + timing.open_settle, stop);
        let mut invalid = false;
        for _ in 0..PROBE_ATTEMPTS {
            match poll(port.as_mut(), timing.reply_timeout) {
                Ok(count) => return Ok((name, port, count)),
                Err(PollError::Invalid) => invalid = true,
                Err(PollError::NoReply) => {}
                Err(PollError::Port) => break,
            }
            if stop.load(Ordering::Relaxed) {
                return Err(results);
            }
        }
        results.push(format!("{name}: {}", if invalid { "invalid reply" } else { "no reply" }));
    }
    Err(results)
}

fn sleep_until(deadline: Instant, stop: &AtomicBool) {
    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        thread::sleep((deadline - now).min(Duration::from_millis(50)));
    }
}

/// Starts acquisition thread. A panic inside loop restarts loop instead of ending acquisition.
pub fn spawn(sink: Arc<dyn Sink>, timing: Timing, stop: Arc<AtomicBool>) -> JoinHandle<()> {
    thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            let result = panic::catch_unwind(AssertUnwindSafe(|| run_loop(sink.as_ref(), &timing, &stop)));
            if result.is_err() {
                sink.message("error", "Acquisition restarted after internal error");
                sleep_until(Instant::now() + timing.scan_interval, &stop);
            }
        }
    })
}

fn run_loop(sink: &dyn Sink, timing: &Timing, stop: &AtomicBool) {
    let mut last_port: Option<String> = None;
    let mut searching_announced = false;
    let mut search_started = Instant::now();
    let mut last_report = String::new();
    while !stop.load(Ordering::Relaxed) {
        if !searching_announced {
            sink.connection(Connection::Searching);
            searching_announced = true;
            search_started = Instant::now();
            last_report.clear();
        }
        let scan_started = Instant::now();
        let (name, mut port, count) = match scan(sink, last_port.as_deref(), timing, stop) {
            Ok(found) => found,
            Err(results) => {
                // Reported after delay, and again only when result of a port changes
                let report = if results.is_empty() { "no serial ports".to_string() } else { results.join("; ") };
                if search_started.elapsed() >= timing.not_found_delay && report != last_report {
                    sink.message("warning", &format!("Detector not found ({report})"));
                    last_report = report;
                }
                sleep_until(scan_started + timing.scan_interval, stop);
                continue;
            }
        };
        searching_announced = false;
        sink.connection(Connection::Connected { port: name.clone() });
        sink.message("info", &format!("Connected to {name}"));
        sink.measurement(now_ms(), count);
        last_port = Some(name.clone());

        let mut next_poll = Instant::now() + timing.poll_interval;
        let mut missed = 0;
        let mut invalid_frames = 0u32;
        loop {
            sleep_until(next_poll, stop);
            if stop.load(Ordering::Relaxed) {
                return;
            }
            next_poll += timing.poll_interval;
            if next_poll < Instant::now() {
                next_poll = Instant::now() + timing.poll_interval;
            }
            match poll(port.as_mut(), timing.reply_timeout) {
                Ok(count) => {
                    missed = 0;
                    sink.measurement(now_ms(), count);
                }
                Err(PollError::Port) => {
                    sink.message("error", &format!("Disconnected from {name}"));
                    break;
                }
                Err(error) => {
                    if let PollError::Invalid = error {
                        invalid_frames += 1;
                        if invalid_frames == 1 {
                            sink.message("warning", &format!("Invalid frame from {name}"));
                        }
                    }
                    missed += 1;
                    if missed >= MAX_MISSED_REPLIES {
                        sink.message("error", &format!("Disconnected from {name}"));
                        break;
                    }
                }
            }
        }
        drop(port);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_open_errors() {
        let denied = serialport::Error::new(serialport::ErrorKind::NoDevice, "Access is denied.");
        assert_eq!(open_failure(&denied), "in use");
        let busy = serialport::Error::new(serialport::ErrorKind::Unknown, "Device or resource busy");
        assert_eq!(open_failure(&busy), "in use");
        let missing =
            serialport::Error::new(serialport::ErrorKind::NoDevice, "The system cannot find the file specified.");
        assert_eq!(open_failure(&missing), "cannot open");
    }
}
