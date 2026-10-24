"""End-to-end test of built application with simulator, tauri-driver and virtual display (Linux only)."""

import os
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Annotated

import typer
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from Xlib import X, display, protocol

ROOT = Path(__file__).resolve().parents[1]
APPLICATION = ROOT / "app/src-tauri/target/debug/co2-monitor"
DATA = ROOT / "CO2 NDIR Monitor/KQ/Na-ZY (09-11).txt"


def start(command: list[str], **kwargs) -> subprocess.Popen:
    """Start background process."""
    return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)


def session() -> webdriver.Remote:
    """Open WebDriver session on application."""
    options = webdriver.ChromeOptions()
    options.set_capability("browserName", "wry")
    options.set_capability("tauri:options", {"application": str(APPLICATION)})
    driver = webdriver.Remote("http://127.0.0.1:4444", options=options)
    driver.implicitly_wait(2)
    return driver


def button(driver: webdriver.Remote, text: str):
    """Find visible button by label."""
    return driver.find_element(By.XPATH, f"//button[normalize-space()='{text}']")


def wait_text(driver: webdriver.Remote, text: str, timeout: float = 60) -> None:
    """Wait until text appears anywhere on page."""
    WebDriverWait(driver, timeout, poll_frequency=0.5).until(lambda current: text in current.find_element(By.TAG_NAME, "body").text)


def close_window(title: str) -> None:
    """Send WM_DELETE_WINDOW to window, as title bar close button does."""
    result = subprocess.run(
        ["xdotool", "search", "--name", title], env=dict(os.environ, DISPLAY=":99"), capture_output=True, check=True, text=True
    )
    connection = display.Display(":99")
    delete = connection.intern_atom("WM_DELETE_WINDOW")
    protocols = connection.intern_atom("WM_PROTOCOLS")
    for window_id in result.stdout.split():
        window = connection.create_resource_object("window", int(window_id))
        event = protocol.event.ClientMessage(window=window, client_type=protocols, data=(32, [delete, X.CurrentTime, 0, 0, 0]))
        window.send_event(event)
    connection.flush()


def window_visible(title: str) -> bool:
    """Return whether window with title is mapped."""
    result = subprocess.run(
        ["xdotool", "search", "--onlyvisible", "--name", title], env=dict(os.environ, DISPLAY=":99"), capture_output=True, check=False
    )
    return bool(result.stdout.strip())


def measurement_count(work: Path) -> int:
    """Count stored measurements in application database."""
    with sqlite3.connect(work / "data/com.catlab.co2monitor/co2-monitor.db") as connection:
        return connection.execute("SELECT COUNT(*) FROM measurements").fetchone()[0]


def fill(driver: webdriver.Remote, element_id: str, value: str) -> None:
    """Replace input value."""
    element = driver.find_element(By.ID, element_id)
    element.send_keys(Keys.CONTROL, "a")
    element.send_keys(Keys.BACKSPACE)
    element.send_keys(value)


def main(
    work: Annotated[Path, typer.Option(help="Work folder")] = Path("/tmp/co2-e2e"),
    step: Annotated[int, typer.Option(help="Samples per second")] = 20,
) -> None:
    """Run end-to-end scenario and save screenshots in work folder."""
    subprocess.run(["rm", "-rf", str(work)], check=True)
    (work / "shots").mkdir(parents=True)
    environment = dict(os.environ, DISPLAY=":99", CO2_EXTRA_PORTS=str(work / "app"), XDG_DATA_HOME=str(work / "data"))
    processes = [start(["Xvfb", ":99", "-screen", "0", "1440x900x24"])]
    time.sleep(1)
    socat = start(["socat", f"pty,raw,echo=0,link={work / 'device'}", f"pty,raw,echo=0,link={work / 'app'}"])
    processes.append(socat)
    time.sleep(1)
    simulator = start([sys.executable, str(ROOT / "tools/simulator.py"), str(work / "device"), "--data", str(DATA), "--step", str(step)])
    processes.append(simulator)
    processes.append(start(["tauri-driver", "--native-driver", "/usr/bin/WebKitWebDriver"], env=environment))
    time.sleep(2)

    def shot(driver: webdriver.Remote, name: str) -> None:
        driver.save_screenshot(str(work / "shots" / f"{name}.png"))

    try:
        driver = session()
        driver.set_window_size(1440, 900)
        wait_text(driver, "Connected", 30)
        time.sleep(4)
        shot(driver, "01-monitor")

        button(driver, "Settings").click()
        fill(driver, "folder", str(work / "exports"))
        fill(driver, "equilibriumDurationS", "40")
        shot(driver, "02-settings")
        button(driver, "Save").click()

        button(driver, "Start").click()
        fill(driver, "sample", "Na-ZY")
        fill(driver, "operator", "Test")
        fill(driver, "massG", "0.56")
        shot(driver, "03-start")
        driver.find_element(By.XPATH, "//div[@role='dialog']//button[normalize-space()='Start']").click()
        time.sleep(8)
        button(driver, "Valve open").click()
        time.sleep(60)
        shot(driver, "04-running")

        # Device stops replying for 10 s, then recovers
        os.kill(simulator.pid, signal.SIGSTOP)
        wait_text(driver, "Disconnected", 30)
        time.sleep(4)
        os.kill(simulator.pid, signal.SIGCONT)
        wait_text(driver, "Connected to", 30)

        wait_text(driver, "Equilibrium reached", 400)
        time.sleep(3)
        shot(driver, "05-equilibrium")
        button(driver, "Finish").click()
        for index, value in enumerate(["59", "60.5", "61", "60", "59.5"]):
            fill(driver, f"flow-{index}", value)
        shot(driver, "06-finish")
        driver.find_element(By.XPATH, "//div[@role='dialog']//button[normalize-space()='Finish']").click()
        wait_text(driver, "Exported", 30)
        time.sleep(2)
        shot(driver, "07-finished")

        driver.find_element(By.XPATH, "//button[normalize-space()='History']").click()
        time.sleep(2)
        driver.find_element(By.XPATH, "//td[normalize-space()='Na-ZY']").click()
        time.sleep(3)
        shot(driver, "08-history")
        driver.find_element(By.XPATH, "//button[normalize-space()='About']").click()
        time.sleep(2)
        shot(driver, "08b-about")

        # Crash during run: application is killed, then restarted
        driver.find_element(By.XPATH, "//button[normalize-space()='Live']").click()
        button(driver, "Start").click()
        fill(driver, "sample", "Crash test")
        driver.find_element(By.XPATH, "//div[@role='dialog']//button[normalize-space()='Start']").click()
        time.sleep(5)

        # Close button during run: window hides to tray and recording continues
        close_window("CO₂ Monitor")
        time.sleep(2)
        assert not window_visible("CO₂ Monitor"), "Window still visible after close during run"
        count = measurement_count(work)
        time.sleep(5)
        assert measurement_count(work) >= count + 3, "Recording stopped after window close"
        print("Close during run: window hidden, recording continues")

        subprocess.run(["pkill", "-9", "-f", str(APPLICATION)], check=False)
        time.sleep(5)
        # Session of killed application can fail to close; new session follows
        try:
            driver.quit()
        except WebDriverException as error:
            print(f"Old session not closed: {error.msg}")
        driver = session()
        driver.set_window_size(1440, 900)
        wait_text(driver, "Run in progress", 30)
        time.sleep(3)
        shot(driver, "09-recovery")
        button(driver, "Resume").click()
        time.sleep(5)
        shot(driver, "10-resumed")
        button(driver, "Abort").click()
        driver.find_element(By.XPATH, "//div[@role='alertdialog']//button[normalize-space()='Abort']").click()
        wait_text(driver, "Run aborted", 30)
        time.sleep(2)
        shot(driver, "11-aborted")
        driver.quit()
    finally:
        for process in reversed(processes):
            process.terminate()
        subprocess.run(["pkill", "-f", str(APPLICATION)], check=False)
    print("Exports:", sorted(path.name for path in (work / "exports").glob("*")))


if __name__ == "__main__":
    typer.run(main)
