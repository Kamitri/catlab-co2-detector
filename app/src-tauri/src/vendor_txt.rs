//! Result file of `CO2 NDIR Monitor.exe`: one line per measurement, "index value", value of CO2 (ppmv) with
//! 15 significant digits.
//!
//! The vendor application calculates scale * exp(exponent * N) in 80-bit extended precision (64-bit mantissa),
//! then writes the result rounded to f64. Calculation in f64 changes the last digit of about 4 % of lines. This
//! module calculates in double-double arithmetic (about 106 bits) and rounds each intermediate result to a 64-bit
//! mantissa, as the x87 unit does.

/// Number as unevaluated sum of two f64, `high + low` with |low| <= ulp(high) / 2.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Wide {
    high: f64,
    low: f64,
}

impl Wide {
    fn new(value: f64) -> Self {
        Self { high: value, low: 0.0 }
    }
}

/// Sum with error term, for |first| >= |second|.
fn quick_two_sum(first: f64, second: f64) -> Wide {
    let sum = first + second;
    Wide { high: sum, low: second - (sum - first) }
}

fn two_sum(first: f64, second: f64) -> Wide {
    let sum = first + second;
    let virtual_second = sum - first;
    let error = (first - (sum - virtual_second)) + (second - virtual_second);
    Wide { high: sum, low: error }
}

fn two_product(first: f64, second: f64) -> Wide {
    let product = first * second;
    Wide { high: product, low: first.mul_add(second, -product) }
}

fn add(first: Wide, second: Wide) -> Wide {
    let sum = two_sum(first.high, second.high);
    quick_two_sum(sum.high, sum.low + first.low + second.low)
}

fn multiply(first: Wide, second: Wide) -> Wide {
    let product = two_product(first.high, second.high);
    quick_two_sum(product.high, product.low + first.high * second.low + first.low * second.high)
}

fn divide(dividend: Wide, divisor: f64) -> Wide {
    let first = dividend.high / divisor;
    let product = two_product(first, divisor);
    let remainder = ((dividend.high - product.high) - product.low) + dividend.low;
    quick_two_sum(first, remainder / divisor)
}

/// Rounds to 64-bit mantissa (round half to even), as x87 extended precision stores a result.
fn round_extended(value: Wide) -> Wide {
    if value.high == 0.0 || !value.high.is_finite() {
        return value;
    }
    let exponent = ((value.high.abs().to_bits() >> 52) & 0x7ff) as i32 - 1023;
    let spacing = 2f64.powi(exponent - 63);
    quick_two_sum(value.high, (value.low / spacing).round_ties_even() * spacing)
}

/// Decimal text such as "1785.9" as extended-precision number, as compiler stores decimal constant.
fn extended_constant(text: &str) -> Option<Wide> {
    let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));
    let digits: u64 = format!("{whole}{fraction}").parse().ok()?;
    // Exact when digits < 2^53 and 10^places <= 10^22
    if digits >= 1 << 53 || fraction.len() > 22 {
        return None;
    }
    Some(round_extended(divide(Wide::new(digits as f64), 10f64.powi(fraction.len() as i32))))
}

const LN2: Wide = Wide { high: std::f64::consts::LN_2, low: 2.319_046_813_846_299_6e-17 };

/// Exponential function, relative error about 1e-30.
fn exp(value: Wide) -> Wide {
    // value = multiple * ln 2 + rest; exp(rest / 512) by Taylor series, then squared 9 times
    let multiple = (value.high / LN2.high).round();
    let rest = add(value, multiply(LN2, Wide::new(-multiple)));
    let small = Wide { high: rest.high / 512.0, low: rest.low / 512.0 };
    // Sum of series without leading 1, for accuracy: exp(small) - 1
    let mut term = small;
    let mut sum = small;
    for order in 2..40 {
        term = divide(multiply(term, small), f64::from(order));
        sum = add(sum, term);
        if term.high.abs() < 1e-36 {
            break;
        }
    }
    // (1 + s)^2 - 1 = s * (s + 2)
    for _ in 0..9 {
        sum = multiply(sum, add(sum, Wide::new(2.0)));
    }
    let result = add(sum, Wide::new(1.0));
    let scale = 2f64.powi(multiple as i32);
    Wide { high: result.high * scale, low: result.low * scale }
}

/// Integer nearest to value (half to even), for values below 2^53.
fn round_integer(value: Wide) -> f64 {
    let nearest = value.high.round();
    let difference = (value.high - nearest) + value.low;
    if difference > 0.5 || (difference == 0.5 && nearest % 2.0 != 0.0) {
        nearest + 1.0
    } else if difference < -0.5 || (difference == -0.5 && nearest % 2.0 != 0.0) {
        nearest - 1.0
    } else {
        nearest
    }
}

/// Positive value with 15 significant digits, without trailing zeros, as `%.15g` for 1e-4 <= value < 1e15.
fn format_15_digits(value: Wide) -> String {
    // Also NaN: range check is false
    if !(1e-4..1e15).contains(&value.high) {
        return format!("{}", value.high);
    }
    let mut power = value.high.log10().floor() as i32;
    let mut digits = 0.0;
    // Correction of power when log10 is off by one near power of 10, or when rounding gives 16 digits
    for _ in 0..3 {
        let shift = 14 - power;
        let scaled =
            if shift >= 0 { multiply(value, Wide::new(10f64.powi(shift))) } else { divide(value, 10f64.powi(-shift)) };
        digits = round_integer(scaled);
        if digits >= 1e15 {
            power += 1;
        } else if digits < 1e14 {
            power -= 1;
        } else {
            break;
        }
    }
    let text = format!("{digits:.0}");
    let mut result = if power >= 0 {
        let point = power as usize + 1;
        format!("{}.{}", &text[..point], &text[point..])
    } else {
        format!("0.{}{text}", "0".repeat((-power - 1) as usize))
    };
    if result.contains('.') {
        result = result.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    result
}

/// Calculation of vendor application: scale * exp(exponent * N) with extended-precision rounding.
pub struct VendorConversion {
    scale: Wide,
    exponent: Wide,
}

impl VendorConversion {
    /// Constants as decimal numbers, as written in source of vendor application (for example 1785.9 and 0.0111).
    /// The shortest decimal text of the f64 values gives these numbers.
    pub fn new(scale: f64, exponent: f64) -> Self {
        let constant = |value: f64| extended_constant(&format!("{value}")).unwrap_or(Wide::new(value));
        Self { scale: constant(scale), exponent: constant(exponent) }
    }

    /// CO2 (ppmv) of raw signal N as text of vendor result file.
    pub fn text(&self, count: f64) -> String {
        let argument = round_extended(multiply(self.exponent, Wide::new(count)));
        let power = round_extended(exp(argument));
        // Result is rounded to f64 before it is written
        format_15_digits(Wide::new(round_extended(multiply(self.scale, power)).high))
    }
}

/// Content of result file: line "index value" for each measurement, index from 1.
pub fn result_file(lines: impl Iterator<Item = String>) -> String {
    lines.enumerate().map(|(index, value)| format!("{} {value}\n", index + 1)).collect()
}

/// CO2 value without raw signal (data edited before raw signal was editable), with 15 significant digits.
pub fn value_text(value: f64) -> String {
    format_15_digits(Wide::new(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{VENDOR_EXPONENT, VENDOR_SCALE};

    #[test]
    fn formats_like_vendor_result_files() {
        let conversion = VendorConversion::new(VENDOR_SCALE, VENDOR_EXPONENT);
        // Lines of RawData.txt and of Na-ZY (09-11).txt (written with decimal comma)
        assert_eq!(conversion.text(120.0), "6766.0840307695");
        assert_eq!(conversion.text(35.0), "2633.78635576965");
    }

    #[test]
    fn every_line_of_vendor_files_matches() {
        let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../CO2 NDIR Monitor/KQ");
        let conversion = VendorConversion::new(VENDOR_SCALE, VENDOR_EXPONENT);
        let mut checked = 0;
        for entry in std::fs::read_dir(folder).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            for line in text.lines() {
                let value = line.split_once(' ').unwrap().1.replace(',', ".");
                let count = ((value.parse::<f64>().unwrap() / VENDOR_SCALE).ln() / VENDOR_EXPONENT).round();
                assert_eq!(conversion.text(count), value, "N = {count}");
                checked += 1;
            }
        }
        assert!(checked > 50_000, "{checked}");
    }

    #[test]
    fn writes_index_from_one() {
        assert_eq!(result_file(["1.5".to_string(), "2".to_string()].into_iter()), "1 1.5\n2 2\n");
        assert_eq!(value_text(2633.786355769651), "2633.78635576965");
    }
}
