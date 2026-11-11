// Images pasted into the chat input. Rust checks them again before `claude` gets them,
// so these checks are only for a quick, clear message.
import type { PastedImage } from "../backend";

/** The types the API takes. */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGES = 10;
/** The API refuses images whose base64 text is over 5 MB. */
export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;

/** A pasted image, with the blob kept for its thumbnail. */
export interface ChatImage extends PastedImage {
  id: number;
  blob: Blob;
}

let nextId = 0;

function isImageType(type: string): type is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(type);
}

/** Reads one pasted file as base64, or explains why it can't be sent. */
export function readImage(blob: Blob): Promise<ChatImage | string> {
  if (!isImageType(blob.type)) {
    return Promise.resolve(
      "Only PNG, JPEG, GIF and WebP images can be sent to Claude.",
    );
  }
  const mediaType = blob.type;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve("The image couldn't be read.");
    reader.onload = () => {
      const url = String(reader.result);
      const data = url.slice(url.indexOf(",") + 1);
      if (data.length > MAX_IMAGE_BASE64) {
        resolve("That image is over Claude's 5 MB limit.");
      } else {
        resolve({ id: nextId++, mediaType, data, blob });
      }
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Draws a thumbnail on a canvas. The CSP allows images only from the app itself, so
 * `<img>` can't show a pasted one; `createImageBitmap` decodes it without a URL.
 */
export async function drawThumbnail(canvas: HTMLCanvasElement, blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const size = canvas.width;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  const context = canvas.getContext("2d");
  context?.drawImage(
    bitmap,
    (size - width) / 2,
    (size - height) / 2,
    width,
    height,
  );
  bitmap.close();
}

/** Draws the whole image at its own size; CSS scales it down to fit. */
export async function drawFull(canvas: HTMLCanvasElement, blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
}
