//! Serial acquisition loop: finds detector on any serial port, polls once per second,
//! reconnects after disconnection. Runs on separate thread, independent of UI.

use std::io::ErrorKind;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serialport::{ClearBuffer, DataBits, FlowControl, Parity, SerialPort, StopBits};

use crate::model::Connection;
use crate::protocol::{FrameError, REQUEST, find_reply};

pub const BAUD_RATE: u32 = 19200;
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
const SCAN_INTERVAL: Duration = Duration::from_secs(2);
const REPLY_TIMEOUT: Duration = Duration::from_millis(500);
/// Searching time before "No detector found" message.
const NOT_FOUND_DELAY: Duration = Duration::from_secs(10);
/// Consecutive missing replies before port is treated as disconnected.
const MAX_MISSED_REPLIES: u32 = 3;

pub trait Sink: Send + Sync + 'static {
    fn reading(&self, timestamp: i64, count: u32);
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
        .timeout(Duration::from_millis(50))
        .open()
}

fn poll(port: &mut dyn SerialPort) -> Result<u32, PollError> {
    port.clear(ClearBuffer::Input).map_err(|_| PollError::Port)?;
    port.write_all(&REQUEST).map_err(|_| PollError::Port)?;
    port.flush().map_err(|_| PollError::Port)?;
    let deadline = Instant::now() + REPLY_TIMEOUT;
    let mut buffer = Vec::with_capacity(32);
    let mut chunk = [0u8; 32];
    let mut last_error = None;
    while Instant::now() < deadline {
        match port.read(&mut chunk) {
            Ok(0) => thread::sleep(Duration::from_millis(10)),
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
    let mut ports: Vec<String> =
        serialport::available_ports().map(|list| list.into_iter().map(|info| info.port_name).collect()).unwrap_or_default();
    for name in extra {
        if !ports.contains(&name) {
            ports.push(name);
        }
    }
    if let Some(preferred) = preferred {
        if let Some(index) = ports.iter().position(|name| name == preferred) {
            let name = ports.remove(index);
            ports.insert(0, name);
        }
    }
    ports
}

/// Opens each candidate port and returns first one that answers with valid frame.
fn scan(sink: &dyn Sink, preferred: Option<&str>) -> Option<(String, Box<dyn SerialPort>, u32)> {
    for name in candidate_ports(sink.extra_ports(), preferred) {
        let Ok(mut port) = open(&name) else { continue };
        if let Ok(count) = poll(port.as_mut()) {
            return Some((name, port, count));
        }
    }
    None
}

fn sleep_until(deadline: Instant, stop: &AtomicBool) {
    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        thread::sleep((deadline - now).min(Duration::from_millis(100)));
    }
}

pub fn spawn(sink: Arc<dyn Sink>, stop: Arc<AtomicBool>) -> JoinHandle<()> {
    thread::spawn(move || run_loop(sink.as_ref(), &stop))
}

fn run_loop(sink: &dyn Sink, stop: &AtomicBool) {
    let mut last_port: Option<String> = None;
    let mut searching_announced = false;
    let mut search_started = Instant::now();
    let mut not_found_reported = false;
    while !stop.load(Ordering::Relaxed) {
        if !searching_announced {
            sink.connection(Connection::Searching);
            searching_announced = true;
            search_started = Instant::now();
            not_found_reported = false;
        }
        let scan_started = Instant::now();
        let (name, mut port, count) = match scan(sink, last_port.as_deref()) {
            Some(found) => found,
            None => {
                if !not_found_reported && search_started.elapsed() >= NOT_FOUND_DELAY {
                    sink.message("warning", "No detector found");
                    not_found_reported = true;
                }
                sleep_until(scan_started + SCAN_INTERVAL, stop);
                continue;
            }
        };
        searching_announced = false;
        sink.connection(Connection::Connected { port: name.clone() });
        sink.message("info", &format!("Connected to {name}"));
        sink.reading(now_ms(), count);
        last_port = Some(name.clone());

        let mut next_poll = Instant::now() + POLL_INTERVAL;
        let mut missed = 0;
        let mut invalid_frames = 0u32;
        loop {
            sleep_until(next_poll, stop);
            if stop.load(Ordering::Relaxed) {
                return;
            }
            next_poll += POLL_INTERVAL;
            if next_poll < Instant::now() {
                next_poll = Instant::now() + POLL_INTERVAL;
            }
            match poll(port.as_mut()) {
                Ok(count) => {
                    missed = 0;
                    sink.reading(now_ms(), count);
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
