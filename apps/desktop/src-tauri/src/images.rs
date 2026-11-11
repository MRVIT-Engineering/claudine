//! Images pasted into the Editor chat. The webview sends base64 text and a type; Rust
//! checks both, and that the bytes really start like that type, before `claude` gets them.

use crate::error::CommandError;
use serde::Deserialize;
use serde_json::{Value, json};

/// The most images one message may carry.
pub const MAX_IMAGES: usize = 10;
/// The API refuses images whose base64 text is over 5 MB.
pub const MAX_IMAGE_BASE64: usize = 5 * 1024 * 1024;

/// The image types the API takes.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub enum ImageType {
    // LEARN: `rename` sets one variant's JSON name; `rename_all` can't produce a "/".
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/gif")]
    Gif,
    #[serde(rename = "image/webp")]
    Webp,
}

impl ImageType {
    fn as_str(self) -> &'static str {
        match self {
            ImageType::Png => "image/png",
            ImageType::Jpeg => "image/jpeg",
            ImageType::Gif => "image/gif",
            ImageType::Webp => "image/webp",
        }
    }

    /// Whether `bytes`, the start of a file, look like this type.
    fn matches(self, bytes: &[u8]) -> bool {
        // LEARN: `b"..."` is a byte string, a `&[u8; N]`, compared byte by byte.
        match self {
            ImageType::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            ImageType::Jpeg => bytes.starts_with(&[0xff, 0xd8, 0xff]),
            ImageType::Gif => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
            ImageType::Webp => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WEBP"[..]),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PastedImage {
    pub media_type: ImageType,
    /// Base64, without a `data:` prefix.
    pub data: String,
}

/// The value of one base64 character, or `None` for anything else.
fn sextet(c: u8) -> Option<u8> {
    match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Whether `data` is well-formed base64: groups of 4, padding only at the very end.
fn is_base64(data: &str) -> bool {
    let bytes = data.as_bytes();
    if bytes.is_empty() || !bytes.len().is_multiple_of(4) {
        return false;
    }
    let body = bytes.len() - bytes.iter().rev().take_while(|&&c| c == b'=').count();
    bytes.len() - body <= 2 && bytes[..body].iter().all(|&c| sextet(c).is_some())
}

/// Decodes the first bytes of `data`, enough to recognize a file type.
fn first_bytes(data: &str) -> Vec<u8> {
    let mut out = Vec::new();
    for group in data.as_bytes().chunks(4).take(4) {
        let values: Vec<u8> = group.iter().filter_map(|&c| sextet(c)).collect();
        // LEARN: `<<` and `|` pack four 6-bit values into three bytes, as in JavaScript.
        let packed = values
            .iter()
            .fold(0u32, |acc, &v| (acc << 6) | u32::from(v))
            << (6 * (4 - values.len()));
        let count = values.len().saturating_sub(1);
        out.extend(packed.to_be_bytes()[1..=count].iter());
    }
    out
}

/// Checks pasted images and turns them into the API's content blocks.
pub fn content_blocks(images: &[PastedImage]) -> Result<Vec<Value>, CommandError> {
    if images.len() > MAX_IMAGES {
        return Err(CommandError::TooLarge);
    }
    images
        .iter()
        .map(|image| {
            if image.data.len() > MAX_IMAGE_BASE64 {
                return Err(CommandError::TooLarge);
            }
            if !is_base64(&image.data) || !image.media_type.matches(&first_bytes(&image.data)) {
                return Err(CommandError::InvalidInput);
            }
            Ok(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type.as_str(),
                    "data": image.data,
                },
            }))
        })
        .collect()
}

/// A user message: plain text, or the images followed by the text.
pub fn user_message(text: &str, images: &[PastedImage]) -> Result<Value, CommandError> {
    let content = if images.is_empty() {
        json!(text)
    } else {
        let mut blocks = content_blocks(images)?;
        if !text.trim().is_empty() {
            blocks.push(json!({ "type": "text", "text": text }));
        }
        Value::Array(blocks)
    };
    Ok(json!({ "type": "user", "message": { "role": "user", "content": content } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // A 1×1 PNG's first bytes, and a GIF header.
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const GIF: &str = "R0lGODlhAQABAAAAACw=";

    fn image(media_type: ImageType, data: &str) -> PastedImage {
        PastedImage {
            media_type,
            data: data.to_string(),
        }
    }

    #[test]
    fn base64_is_decoded_and_checked() {
        assert_eq!(&first_bytes(PNG)[..8], b"\x89PNG\r\n\x1a\n");
        assert!(first_bytes(GIF).starts_with(b"GIF89a"));
        assert!(is_base64(GIF));
        assert!(!is_base64("abc"));
        assert!(!is_base64("ab=c"));
        assert!(!is_base64("a==="));
        assert!(!is_base64("ab\"}"));
    }

    #[test]
    fn images_must_match_their_type() {
        assert!(content_blocks(&[image(ImageType::Png, PNG)]).is_ok());
        assert!(matches!(
            content_blocks(&[image(ImageType::Jpeg, PNG)]),
            Err(CommandError::InvalidInput)
        ));
        let many: Vec<PastedImage> = (0..=MAX_IMAGES)
            .map(|_| image(ImageType::Gif, GIF))
            .collect();
        assert!(matches!(content_blocks(&many), Err(CommandError::TooLarge)));
    }

    #[test]
    fn messages_put_images_before_text() {
        let message = user_message("What's this?", &[image(ImageType::Gif, GIF)]).unwrap();
        let content = &message["message"]["content"];
        assert_eq!(content[0]["source"]["media_type"], "image/gif");
        assert_eq!(content[1]["text"], "What's this?");
        let plain = user_message("hi", &[]).unwrap();
        assert_eq!(plain["message"]["content"], "hi");
    }
}
