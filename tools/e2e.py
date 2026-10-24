"""End-to-end test of built application with simulator, tauri-driver and virtual display (Linux only)."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import typer
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

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


def fill(driver: webdriver.Remote, element_id: str, value: str) -> None:
    """Replace input value."""
    element = driver.find_element(By.ID, element_id)
    element.send_keys(Keys.CONTROL, "a")
    element.send_keys(Keys.BACKSPACE)
    element.send_keys(value)


def main(work: Path = typer.Option(Path("/tmp/co2-e2e"), help="Work folder"), step: int = typer.Option(20, help="Samples per second")) -> None:
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
    shot = lambda driver, name: driver.save_screenshot(str(work / "shots" / f"{name}.png"))
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

        # Device stops answering for 10 s, then recovers
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

        # Crash during run: application is killed, then restarted
        driver.find_element(By.XPATH, "//button[normalize-space()='Live']").click()
        button(driver, "Start").click()
        fill(driver, "sample", "Crash test")
        driver.find_element(By.XPATH, "//div[@role='dialog']//button[normalize-space()='Start']").click()
        time.sleep(10)
        subprocess.run(["pkill", "-9", "-f", str(APPLICATION)], check=False)
        time.sleep(5)
        try:
            driver.quit()
        except Exception:
            pass
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
