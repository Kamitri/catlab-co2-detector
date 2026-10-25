# CO₂ NDIR Monitor: serial protocol and conversion

This document describes how `CO2 NDIR Monitor.exe` communicates with the CO₂ NDIR
detector and how it converts the reply into a CO₂ value. The results come from
static analysis of the executable with REA and Ghidra 12.1.4. The conversion is
verified against every logged value in `CO2 NDIR Monitor/KQ/` and
`CO2 NDIR Monitor/Nhả hấp phụ/` (about 94,000 values, 0 mismatches).

## Serial settings

| Setting      | Value |
| ------------ | ----- |
| Baud rate    | 19200 |
| Data bits    | 8     |
| Stop bits    | 1     |
| Parity       | None  |
| Flow control | None  |

## Polling

The application polls once per second (`ProcessTimer`, Delphi default interval of
1000 ms). Each tick clears the receive buffer and sends one fixed request:

```
40 00 52 00 00 00 52 21
```

The request is hard-coded in `ProcessTimerTimer` (0x4ad4f8). The application does
not compute its checksum at run time.

## Reply frame

The detector replies with 8 bytes:

| Offset | Example | Meaning                                         |
| ------ | ------- | ----------------------------------------------- |
| 0      | `40`    | Start byte (`@`)                                |
| 1      | `04`    | Unknown; `00` in request, `04` in every reply   |
| 2      | `52`    | Command echo (`R`)                              |
| 3      | `00`    | Count N, BCD digits 1 to 2 (most significant)   |
| 4      | `01`    | Count N, BCD digits 3 to 4                      |
| 5      | `20`    | Count N, BCD digits 5 to 6 (least significant)  |
| 6      | `77`    | Checksum: XOR of bytes 1 to 5                   |
| 7      | `21`    | End byte (`!`)                                  |

The count N is binary-coded decimal. The application converts bytes 3, 4, and 5
to 2-digit hexadecimal text, joins them, and parses the result as a decimal
integer. For `00 01 20`, the text is `000120` and N is 120.

The checksum is an XOR, not a sum. It is consistent with all 3 frames in the
screenshot of the Protocol data tab:

| Reply frame                | N   | XOR of bytes 1 to 5 |
| -------------------------- | --- | ------------------- |
| `40 04 52 00 01 20 77 21`  | 120 | `77`                |
| `40 04 52 00 01 22 75 21`  | 122 | `75`                |
| `40 04 52 00 01 21 76 21`  | 121 | `76` (inferred)     |

The application does not verify the checksum.

## Conversion to CO₂ concentration

`ComPortRxChar` (0x4ad90c) computes the displayed value as

```
CO₂ = 1785.9 * exp(0.0111 * N)
```

The constants are 80-bit floating-point values at 0x4adcf0 (1785.9) and 0x4adce4
(0.0111). The exponential is the Delphi runtime routine at 0x402a08. The display
uses the format `%5.0f`, so 6841.6 is shown as 6842.

| N   | CO₂       |
| --- | --------- |
| 0   | 1785.9    |
| 120 | 6766.08   |
| 121 | 6841.61   |
| 122 | 6917.97   |
| 278 | 39 084.36 |

The unit is not written anywhere in the executable. Ppm is the likely unit.

### Consequences for measurements

- The lowest value the formula can produce is 1785.9 (N = 0). Concentrations
  below that, including ambient air (about 420 ppm), are not representable. The
  lowest N in the logged data is 19 (2205.2).
- One count is a step of 1.12 % of the current value: about 76 at 6800 and about
  440 at 39 000.
- The formula is fixed in the executable. It is the same for every detector, and
  the application does not have a calibration setting.

## Parser quirk in the application

The application treats the first `!` (0x21) in the receive buffer as the end of a
frame. When byte 5 is 0x21 (N = 121, 221, ...), the frame is cut after byte 5 and
the screenshot shows the short frame `40 04 52 00 01 21`. The value is still
correct because byte 5 is part of the cut frame, and the remaining 2 bytes are
discarded when the buffer is cleared on the next tick. A replacement program
should parse fixed 8-byte frames and verify the checksum.

## Saved data files

The Save function writes 1 line per sample: the sample index and the CO₂ value,
separated by a space. The decimal separator follows the Windows locale, which is
the reason some files use a comma. At 1 sample per second, the index is the
elapsed time in seconds.

## Reference decoder

```python
import math


def decode_reply(frame: bytes) -> float:
    """Return the CO₂ value encoded in one 8-byte reply frame."""
    if len(frame) != 8 or frame[0] != 0x40 or frame[7] != 0x21:
        raise ValueError(f"Invalid frame: {frame.hex(' ')}")
    checksum = 0
    for value in frame[1:6]:
        checksum ^= value
    if checksum != frame[6]:
        raise ValueError(f"Checksum mismatch: {frame.hex(' ')}")
    count = int(frame[3:6].hex())
    return 1785.9 * math.exp(0.0111 * count)
```

## Open questions

- Meaning of byte 1 (`00` in the request, `04` in the reply).
- Whether the detector accepts other commands besides `52`. The application
  sends only this one.
