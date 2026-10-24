"""Detector simulator for development: answers poll requests on serial port with values from legacy result file."""

import math
import sys
import time

import serial
import typer

REQUEST = bytes([0x40, 0x00, 0x52, 0x00, 0x00, 0x00, 0x52, 0x21])
SCALE = 1785.9
EXPONENT = 0.0111


def encode_reply(count: int) -> bytes:
    """Encode count N as 8-byte reply frame with BCD digits and XOR checksum."""
    digits = f"{count:06d}"
    frame = [0x40, 0x04, 0x52] + [int(digits[index : index + 2], 16) for index in range(0, 6, 2)]
    checksum = 0
    for value in frame[1:6]:
        checksum ^= value
    return bytes(frame + [checksum, 0x21])


def load_counts(path: str) -> list[int]:
    """Load CO2 values from legacy result file and convert them back to counts."""
    counts = []
    with open(path, encoding="latin-1") as file:
        for line in file:
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                value = float(parts[1].replace(",", "."))
            except ValueError:
                continue
            counts.append(round(math.log(value / SCALE) / EXPONENT))
    return counts


def main(
    port: str = typer.Argument(..., help="Serial port of simulated detector"),
    data: str = typer.Option("", help="Legacy result file to replay"),
    step: int = typer.Option(1, help="Samples to advance per request"),
    corrupt_every: int = typer.Option(0, help="Send bad checksum every N replies (0 disables)"),
    offset: int = typer.Option(0, help="Index of first sample to replay"),
) -> None:
    """Answer poll requests like CO2 NDIR detector."""
    counts = load_counts(data) if data else [35] * 60 + [260] * 600
    connection = serial.Serial(port, 19200, timeout=0.1)
    buffer = b""
    index = offset
    replies = 0
    print(f"Simulator on {port} with {len(counts)} samples", flush=True)
    while True:
        buffer += connection.read(64)
        position = buffer.find(REQUEST)
        if position < 0:
            buffer = buffer[-16:]
            continue
        buffer = buffer[position + len(REQUEST) :]
        frame = bytearray(encode_reply(counts[min(index, len(counts) - 1)]))
        replies += 1
        if corrupt_every and replies % corrupt_every == 0:
            frame[6] ^= 0xFF
        connection.write(frame)
        index += step


if __name__ == "__main__":
    typer.run(main)
