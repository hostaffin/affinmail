//! F-085: RFC 6238 TOTP (HMAC-SHA1) + RFC 4648 base32, self-contained.
//! No new crates: SHA-1/HMAC implemented by hand, randomness from uuid v4.

/// Generate a random 20-byte secret, base32-encoded.
pub fn generate_secret() -> String {
    // Two uuid v4s = 32 bytes of randomness; take 20.
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    base32_encode(&bytes[..20])
}

/// 10 recovery codes in XXXX-XXXX format.
pub fn generate_recovery_codes() -> Vec<String> {
    let mut hex = String::new();
    while hex.len() < 80 {
        hex.push_str(&uuid::Uuid::new_v4().simple().to_string());
    }
    (0..10)
        .map(|i| {
            let c = &hex[i * 8..i * 8 + 8];
            format!("{}-{}", &c[0..4], &c[4..8])
        })
        .collect()
}

/// RFC 4648 base32 (A-Z, 2-7), no padding.
pub fn base32_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::new();
    for chunk in data.chunks(5) {
        let mut buf = [0u8; 5];
        buf[..chunk.len()].copy_from_slice(chunk);
        let bits = u64::from_be_bytes([
            0, buf[0], buf[1], buf[2], buf[3], buf[4], 0, 0,
        ]) >> 16; // top 40 bits
        let n_chars = (chunk.len() * 8 + 4) / 5; // ceil(bits/5)
        for i in 0..n_chars {
            out.push(ALPHABET[((bits >> (35 - i * 5)) & 0x1f) as usize] as char);
        }
    }
    out
}

/// RFC 4648 base32 decode; '=' padding stripped, case-insensitive.
pub fn base32_decode(s: &str) -> Result<Vec<u8>, String> {
    let mut bits: u32 = 0;
    let mut nbits: u32 = 0;
    let mut out = Vec::new();
    for c in s.bytes().filter(|&c| c != b'=').map(|c| c.to_ascii_uppercase()) {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'2'..=b'7' => c - b'2' + 26,
            _ => return Err(format!("invalid base32 character: {:?}", c as char)),
        };
        bits = (bits << 5) | v as u32;
        nbits += 5;
        if nbits >= 8 {
            nbits -= 8;
            out.push((bits >> nbits) as u8);
        }
    }
    Ok(out)
}

/// TOTP code for a base32 secret at `unix_time` (RFC 6238, SHA-1, 6 digits, 30s step).
pub fn code_at(secret_base32: &str, unix_time: u64) -> Option<String> {
    let key = base32_decode(secret_base32).ok()?;
    let counter = (unix_time / 30).to_be_bytes();
    let mac = hmac_sha1(&key, &counter);
    let offset = (mac[19] & 0x0f) as usize;
    let bin = u32::from_be_bytes([mac[offset] & 0x7f, mac[offset + 1], mac[offset + 2], mac[offset + 3]]);
    Some(format!("{:06}", bin % 1_000_000))
}

/// Verify a code against the current window ±1 step (RFC 6238 §5.2).
pub fn verify(secret_base32: &str, code: &str, unix_time: u64) -> bool {
    let code = code.trim();
    let now = unix_time as i64;
    [-1i64, 0, 1].iter().any(|&delta| {
        code_at(secret_base32, (now + delta * 30).max(0) as u64).as_deref() == Some(code)
    })
}

fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut msg = data.to_vec();
    let ml = (data.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&ml.to_be_bytes());

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }

    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

fn hmac_sha1(key: &[u8], msg: &[u8]) -> [u8; 20] {
    let mut key = key.to_vec();
    if key.len() > 64 {
        key = sha1(&key).to_vec();
    }
    key.resize(64, 0);
    let ipad: Vec<u8> = key.iter().map(|b| b ^ 0x36).collect();
    let opad: Vec<u8> = key.iter().map(|b| b ^ 0x5c).collect();
    let inner = sha1(&[ipad, msg.to_vec()].concat());
    sha1(&[opad, inner.to_vec()].concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_known_vectors() {
        let hex = |d: &[u8]| sha1(d).iter().map(|b| format!("{:02x}", b)).collect::<String>();
        assert_eq!(hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(hex(b""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    }

    #[test]
    fn totp_rfc6238_vector() {
        // RFC 6238 Appendix B test secret ("12345678901234567890") in base32.
        let secret = base32_encode(b"12345678901234567890");
        assert_eq!(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        assert_eq!(code_at(&secret, 59).as_deref(), Some("287082"));
        assert_eq!(code_at(&secret, 1111111109).as_deref(), Some("081804"));
    }

    #[test]
    fn base32_roundtrip() {
        let data = (0u8..=100).collect::<Vec<u8>>();
        assert_eq!(base32_decode(&base32_encode(&data)).unwrap(), data);
        assert_eq!(base32_decode("gezdgnbv").unwrap(), b"12345".to_vec());
    }

    #[test]
    fn recovery_code_format() {
        for code in generate_recovery_codes() {
            let parts: Vec<&str> = code.split('-').collect();
            assert_eq!(parts.len(), 2);
            assert_eq!(parts[0].len(), 4);
            assert_eq!(parts[1].len(), 4);
            assert!(code.chars().all(|c| c == '-' || c.is_ascii_hexdigit()));
        }
    }
}
