//! End-to-end test of acquisition loop against simulator on virtual serial port.
//! Requires socat and python3 with pyserial and typer. Run with: cargo test -- --ignored

use std::process::{Child, Command};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use co2_monitor_lib::acquisition::{Sink, spawn};
use co2_monitor_lib::model::Connection;

#[derive(Default)]
struct Recorder {
    readings: Mutex<Vec<(i64, u32)>>,
    connections: Mutex<Vec<Connection>>,
    messages: Mutex<Vec<String>>,
    ports: Vec<String>,
}

impl Sink for Recorder {
    fn reading(&self, timestamp: i64, count: u32) {
        self.readings.lock().unwrap().push((timestamp, count));
    }
    fn connection(&self, connection: Connection) {
        self.connections.lock().unwrap().push(connection);
    }
    fn message(&self, _level: &str, text: &str) {
        self.messages.lock().unwrap().push(text.to_string());
    }
    fn extra_ports(&self) -> Vec<String> {
        self.ports.clone()
    }
}

struct VirtualDevice {
    socat: Child,
    simulator: Child,
}

impl VirtualDevice {
    fn start(directory: &std::path::Path) -> Self {
        let device = directory.join("device");
        let app = directory.join("app");
        let socat = Command::new("socat")
            .arg(format!("pty,raw,echo=0,link={}", device.display()))
            .arg(format!("pty,raw,echo=0,link={}", app.display()))
            .spawn()
            .expect("Socat is required");
        let deadline = Instant::now() + Duration::from_secs(5);
        while !(device.exists() && app.exists()) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        let simulator = Command::new("python3")
            .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tools/simulator.py"))
            .arg(&device)
            .spawn()
            .expect("Python 3 is required");
        Self { socat, simulator }
    }

    fn stop(mut self) {
        let _ = self.simulator.kill();
        let _ = self.socat.kill();
        let _ = self.simulator.wait();
        let _ = self.socat.wait();
    }
}

fn wait_for(condition: impl Fn() -> bool, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

#[test]
#[ignore]
fn connects_polls_and_reconnects() {
    let directory = tempfile::tempdir().unwrap();
    let app_port = directory.path().join("app").display().to_string();
    let recorder = Arc::new(Recorder { ports: vec![app_port.clone()], ..Default::default() });
    let stop = Arc::new(AtomicBool::new(false));
    let handle = spawn(recorder.clone(), stop.clone());

    let device = VirtualDevice::start(directory.path());
    let connected = Connection::Connected { port: app_port.clone() };
    assert!(wait_for(|| recorder.connections.lock().unwrap().contains(&connected), Duration::from_secs(10)));
    assert!(wait_for(|| recorder.readings.lock().unwrap().len() >= 3, Duration::from_secs(10)));
    assert_eq!(recorder.readings.lock().unwrap()[0].1, 35);

    // Unplug: readings stop and loop goes back to searching
    device.stop();
    let count_before = recorder.readings.lock().unwrap().len();
    assert!(wait_for(
        || recorder.messages.lock().unwrap().iter().any(|text| text.starts_with("Disconnected")),
        Duration::from_secs(10)
    ));
    assert!(recorder.readings.lock().unwrap().len() <= count_before + 1);

    // Plug back in: loop reconnects without user action
    let device = VirtualDevice::start(directory.path());
    assert!(wait_for(
        || recorder.connections.lock().unwrap().iter().filter(|connection| **connection == connected).count() >= 2,
        Duration::from_secs(15)
    ));
    assert!(wait_for(|| recorder.readings.lock().unwrap().len() >= count_before + 3, Duration::from_secs(10)));

    // Readings arrive about once per second
    let readings = recorder.readings.lock().unwrap().clone();
    let last = &readings[readings.len() - 3..];
    for pair in last.windows(2) {
        let interval = pair[1].0 - pair[0].0;
        assert!((800..=1300).contains(&interval), "Interval {interval} ms");
    }

    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    handle.join().unwrap();
    device.stop();
    println!("{:#?}", recorder.messages.lock().unwrap());
}
