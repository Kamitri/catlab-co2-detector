//! Serial protocol of CO2 NDIR detector, recovered from `CO2 NDIR Monitor.exe`.
//!
//! See `docs/protocol.md` for frame layout and evidence.

/// Poll request sent once per second.
pub const REQUEST: [u8; 8] = [0x40, 0x00, 0x52, 0x00, 0x00, 0x00, 0x52, 0x21];

pub const FRAME_LENGTH: usize = 8;
const START_BYTE: u8 = 0x40;
const END_BYTE: u8 = 0x21;

/// Conversion constants hard-coded in vendor application.
pub const VENDOR_SCALE: f64 = 1785.9;
pub const VENDOR_EXPONENT: f64 = 0.0111;

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    Incomplete,
    BadChecksum,
    BadDigit,
}

/// Decodes one 8-byte reply frame and returns count N.
pub fn decode_reply(frame: &[u8]) -> Result<u32, FrameError> {
    if frame.len() != FRAME_LENGTH || frame[0] != START_BYTE || frame[7] != END_BYTE {
        return Err(FrameError::Incomplete);
    }
    let checksum = frame[1..6].iter().fold(0u8, |accumulator, byte| accumulator ^ byte);
    if checksum != frame[6] {
        return Err(FrameError::BadChecksum);
    }
    // Count is binary-coded decimal over bytes 3 to 5
    let mut count = 0u32;
    for byte in &frame[3..6] {
        let high = u32::from(byte >> 4);
        let low = u32::from(byte & 0x0f);
        if high > 9 || low > 9 {
            return Err(FrameError::BadDigit);
        }
        count = count * 100 + high * 10 + low;
    }
    Ok(count)
}

/// Finds first valid frame in buffer and returns count N.
pub fn find_reply(buffer: &[u8]) -> Result<u32, FrameError> {
    let mut last_error = FrameError::Incomplete;
    for start in 0..buffer.len() {
        if buffer[start] != START_BYTE || start + FRAME_LENGTH > buffer.len() {
            continue;
        }
        match decode_reply(&buffer[start..start + FRAME_LENGTH]) {
            Ok(count) => return Ok(count),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

/// Converts count N to CO2 concentration (ppmv).
pub fn concentration(count: u32, scale: f64, exponent: f64) -> f64 {
    scale * (exponent * f64::from(count)).exp()
}

/// Encodes count N as reply frame. Used by tests and simulator.
pub fn encode_reply(count: u32) -> [u8; 8] {
    let digits = format!("{:06}", count % 1_000_000);
    let digits = digits.as_bytes();
    let mut frame = [0x40, 0x04, 0x52, 0, 0, 0, 0, 0x21];
    for index in 0..3 {
        frame[3 + index] = ((digits[index * 2] - b'0') << 4) | (digits[index * 2 + 1] - b'0');
    }
    frame[6] = frame[1..6].iter().fold(0u8, |accumulator, byte| accumulator ^ byte);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_frames_from_vendor_log() {
        assert_eq!(decode_reply(&[0x40, 0x04, 0x52, 0x00, 0x01, 0x20, 0x77, 0x21]), Ok(120));
        assert_eq!(decode_reply(&[0x40, 0x04, 0x52, 0x00, 0x01, 0x22, 0x75, 0x21]), Ok(122));
        assert_eq!(decode_reply(&[0x40, 0x04, 0x52, 0x00, 0x01, 0x21, 0x76, 0x21]), Ok(121));
    }

    #[test]
    fn request_checksum_is_xor() {
        let checksum = REQUEST[1..6].iter().fold(0u8, |accumulator, byte| accumulator ^ byte);
        assert_eq!(checksum, REQUEST[6]);
    }

    #[test]
    fn rejects_bad_checksum() {
        assert_eq!(
            decode_reply(&[0x40, 0x04, 0x52, 0x00, 0x01, 0x20, 0x78, 0x21]),
            Err(FrameError::BadChecksum)
        );
    }

    #[test]
    fn finds_frame_after_noise() {
        let mut buffer = vec![0x00, 0x21, 0x40, 0x13];
        buffer.extend_from_slice(&encode_reply(262));
        assert_eq!(find_reply(&buffer), Ok(262));
    }

    #[test]
    fn encode_round_trips() {
        for count in [0, 1, 19, 121, 278, 999] {
            assert_eq!(decode_reply(&encode_reply(count)), Ok(count));
        }
    }

    #[test]
    fn matches_vendor_values() {
        assert!((concentration(120, VENDOR_SCALE, VENDOR_EXPONENT) - 6766.0840307695).abs() < 1e-6);
        assert!((concentration(121, VENDOR_SCALE, VENDOR_EXPONENT) - 6841.60593465807).abs() < 1e-6);
    }
}
