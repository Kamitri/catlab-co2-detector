"""End-to-end test of built application with simulator, tauri-driver and virtual display (Linux only)."""

import os
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Annotated

import typer
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.action_builder import ActionBuilder
from selenium.webdriver.common.actions.mouse_button import MouseButton
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from Xlib import X, display, protocol

ROOT = Path(__file__).resolve().parents[1]
APPLICATION = ROOT / "app/src-tauri/target/debug/CATlab CO2 Monitor"
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


def wait_until(condition: Callable[[], bool], timeout: float = 30, message: str = "Condition not reached") -> None:
    """Poll condition until true; raise after timeout."""
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            raise TimeoutError(message)
        time.sleep(0.05)


def page_text(driver: webdriver.Remote) -> str:
    """Return visible text of page."""
    return driver.find_element(By.TAG_NAME, "body").text


def wait_text(driver: webdriver.Remote, text: str, timeout: float = 30, count: int = 1) -> None:
    """Wait until text appears on page at least count times."""
    wait_until(lambda: page_text(driver).count(text) >= count, timeout, f"Text not shown: {text}")


def co2_value(driver: webdriver.Remote) -> float:
    """Return current CO₂ value of status panel, or 0 before first measurement."""
    text = driver.find_element(By.CSS_SELECTOR, "aside span.text-4xl").text.replace(",", "")
    return float(text) if text.replace(".", "").isdigit() else 0.0


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


def axis_ranges(driver: webdriver.Remote) -> list[list[float]]:
    """Return rounded x and y axis ranges of chart."""
    ranges = driver.execute_script(
        "const plot = document.querySelector('.js-plotly-plot'); return [plot.layout.xaxis.range, plot.layout.yaxis.range]"
    )
    return [[round(value, 1) for value in axis] for axis in ranges]


def port_open(port: int) -> bool:
    """Return whether local TCP port accepts connections."""
    with socket.socket() as connection:
        return connection.connect_ex(("127.0.0.1", port)) == 0


def fill(driver: webdriver.Remote, element_id: str, value: str) -> None:
    """Replace input value."""
    element = driver.find_element(By.ID, element_id)
    element.send_keys(Keys.CONTROL, "a")
    element.send_keys(Keys.BACKSPACE)
    element.send_keys(value)


def main(
    work: Annotated[Path, typer.Option(help="Work folder")] = Path("/tmp/co2-e2e"),
    step: Annotated[int, typer.Option(help="Samples per poll")] = 20,
    poll_interval: Annotated[int, typer.Option(help="Poll interval of application (ms)")] = 50,
) -> None:
    """Run end-to-end scenario and save screenshots in work folder."""
    subprocess.run(["rm", "-rf", str(work)], check=True)
    (work / "shots").mkdir(parents=True)
    environment = dict(
        os.environ,
        DISPLAY=":99",
        CO2_EXTRA_PORTS=str(work / "app"),
        CO2_POLL_INTERVAL_MS=str(poll_interval),
        XDG_DATA_HOME=str(work / "data"),
    )
    processes = [start(["Xvfb", ":99", "-screen", "0", "1440x900x24"])]
    wait_until(lambda: Path("/tmp/.X11-unix/X99").exists(), 10, "Virtual display not started")
    processes.append(start(["socat", f"pty,raw,echo=0,link={work / 'device'}", f"pty,raw,echo=0,link={work / 'app'}"]))
    wait_until(lambda: (work / "device").exists() and (work / "app").exists(), 10, "Virtual serial port not created")
    simulator = start([sys.executable, str(ROOT / "tools/simulator.py"), str(work / "device"), "--data", str(DATA), "--step", str(step)])
    processes.append(simulator)
    processes.append(start(["tauri-driver", "--native-driver", "/usr/bin/WebKitWebDriver"], env=environment))
    wait_until(lambda: port_open(4444), 10, "tauri-driver not started")
    started = time.monotonic()

    def shot(driver: webdriver.Remote, name: str) -> None:
        driver.save_screenshot(str(work / "shots" / f"{name}.png"))

    try:
        driver = session()
        driver.set_window_size(1440, 900)
        wait_text(driver, "Connected to")
        wait_until(lambda: co2_value(driver) > 0, message="Measurement not shown")
        shot(driver, "01-monitor")

        button(driver, "Settings").click()
        fill(driver, "folder", str(work / "exports"))
        fill(driver, "equilibriumDurationS", "2")
        fill(driver, "equilibriumBandPercent", "5")
        shot(driver, "02-settings")
        button(driver, "Save").click()
        wait_text(driver, "Settings saved")

        # Windows scaled to fast poll interval: data of 1 s real time covers about 400 s of run
        button(driver, "Start").click()
        fill(driver, "sample", "Na-ZY")
        fill(driver, "operator", "Test")
        fill(driver, "massG", "0.56")
        fill(driver, "baselineWindowS", "0.5")
        fill(driver, "coWindowS", "1")
        shot(driver, "03-start")
        driver.find_element(By.XPATH, "//div[@role='dialog']//button[normalize-space()='Start']").click()
        wait_text(driver, "Run started: Na-ZY")
        button(driver, "Valve open").click()
        wait_until(lambda: co2_value(driver) > 15000, message="Breakthrough not reached")
        shot(driver, "04-running")

        # Device stops replying for 2 s, then recovers
        frozen = time.monotonic()
        os.kill(simulator.pid, signal.SIGSTOP)
        wait_text(driver, "Disconnected from")
        wait_until(lambda: time.monotonic() - frozen > 2)
        os.kill(simulator.pid, signal.SIGCONT)
        wait_text(driver, "Connected to", count=2)

        wait_text(driver, "Equilibrium reached", 60)
        shot(driver, "05-equilibrium")
        button(driver, "Finish").click()
        for index, value in enumerate(["59", "60.5", "61", "60", "59.5"]):
            fill(driver, f"flow-{index}", value)
        shot(driver, "06-finish")
        driver.find_element(By.XPATH, "//div[@role='dialog']//button[normalize-space()='Finish']").click()
        wait_text(driver, "Exported")
        shot(driver, "07-finished")

        driver.find_element(By.XPATH, "//button[normalize-space()='History']").click()
        driver.find_element(By.XPATH, "//td[normalize-space()='Na-ZY']").click()
        wait_text(driver, "Stoichiometric time")
        shot(driver, "08-history")
        driver.find_element(By.XPATH, "//button[normalize-space()='About']").click()
        wait_text(driver, "All rights reserved")
        shot(driver, "08b-about")

        # Close button during run: window hides to tray and recording continues
        driver.find_element(By.XPATH, "//button[normalize-space()='Live']").click()
        button(driver, "Start").click()
        fill(driver, "sample", "Crash test")
        driver.find_element(By.XPATH, "//div[@role='dialog']//button[normalize-space()='Start']").click()
        wait_text(driver, "Run started: Crash test")
        close_window("CO₂ Monitor")
        wait_until(lambda: not window_visible("CO₂ Monitor"), 5, "Window still visible after close during run")
        count = measurement_count(work)
        wait_until(lambda: measurement_count(work) >= count + 5, 5, "Recording stopped after window close")
        print("Close during run: window hidden, recording continues")

        # Crash during run: application is killed, then restarted
        subprocess.run(["pkill", "-9", "-f", str(APPLICATION)], check=False)
        wait_until(lambda: subprocess.run(["pgrep", "-f", str(APPLICATION)], capture_output=True, check=False).returncode != 0, 10)
        # Session of killed application can fail to close; new session follows
        try:
            driver.quit()
        except WebDriverException as error:
            print(f"Old session not closed: {error.msg}")
        driver = session()
        driver.set_window_size(1440, 900)
        wait_text(driver, "Run in progress")
        shot(driver, "09-recovery")
        button(driver, "Resume").click()
        wait_text(driver, "Connected to", count=3)
        shot(driver, "10-resumed")
        button(driver, "Abort").click()
        driver.find_element(By.XPATH, "//div[@role='alertdialog']//button[normalize-space()='Abort']").click()
        wait_text(driver, "Exported", count=2)
        shot(driver, "11-aborted")

        # Chart view checks run last: after WebDriver pointer actions, WebKit WebDriver drops Shift in typing
        # Default view: fixed axes that do not follow each new measurement
        default = [[0, 5000], [0, 40000]]
        assert axis_ranges(driver) == default, axis_ranges(driver)
        count = measurement_count(work)
        wait_until(lambda: measurement_count(work) >= count + 20, 10, "Measurements stopped")
        assert axis_ranges(driver) == default, axis_ranges(driver)

        # Axes tool sets exact ranges
        button(driver, "Axes").click()
        fill(driver, "axes-xTo", "1000")
        fill(driver, "axes-yTo", "10000")
        shot(driver, "01b-axes")
        button(driver, "Apply").click()
        wait_until(lambda: axis_ranges(driver) == [[0, 1000], [0, 10000]], 5, "Axes not applied")

        # Space with drag pans while Zoom tool stays selected. Key events come from script: WebDriver key
        # actions leave keyboard state that drops Shift in later typing
        plot = driver.find_element(By.CSS_SELECTOR, ".js-plotly-plot .nsewdrag")
        space = "window.dispatchEvent(new KeyboardEvent(arguments[0], {code: 'Space', key: ' ', bubbles: true}))"
        driver.execute_script(space, "keydown")
        ActionChains(driver).click_and_hold(plot).move_by_offset(-150, 0).release().perform()
        driver.execute_script(space, "keyup")
        wait_until(lambda: axis_ranges(driver)[0][0] > 0, 5, "Space drag did not pan")

        # Middle button drag pans
        before = axis_ranges(driver)[0][0]
        action = ActionBuilder(driver)
        action.pointer_action.move_to(plot).pointer_down(MouseButton.MIDDLE).move_by(-150, 0).pointer_up(MouseButton.MIDDLE)
        action.perform()
        wait_until(lambda: axis_ranges(driver)[0][0] > before, 5, "Middle button drag did not pan")
        assert not driver.find_elements(By.CSS_SELECTOR, ".notifier-note"), "Plotly tip shown"
        button(driver, "Reset view").click()
        wait_until(lambda: axis_ranges(driver) == default, 5, "Reset view did not restore default view")
        print("Chart view: default, Axes, Space pan, middle button pan, Reset view")
        driver.quit()
    finally:
        for process in reversed(processes):
            process.terminate()
        subprocess.run(["pkill", "-f", str(APPLICATION)], check=False)
    print(f"Scenario passed in {time.monotonic() - started:.0f} s")
    print("Exports:", sorted(path.name for path in (work / "exports").glob("*")))


if __name__ == "__main__":
    typer.run(main)
