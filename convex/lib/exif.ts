// EXIF / GPS detection (spec §18.1).
//
// Photos are downscaled + EXIF-stripped CLIENT-side, then a server action
// re-parses headers and rejects anything still carrying EXIF/GPS — a cheap
// header check, not a re-encode. Handoff photos must never leak members' home
// coordinates. This is a conservative detector: it flags the metadata-carrying
// markers of the formats we accept (JPEG/WebP/PNG); a cleanly re-encoded image
// has none of them.

const td = new TextDecoder("latin1");

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return td.decode(bytes.subarray(start, start + len));
}

/** JPEG APP1 "Exif\0\0" segment. */
function jpegHasExif(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false; // not JPEG
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const segLen = (b[i + 2]! << 8) | b[i + 3]!;
    if (segLen < 2) break;
    if (marker === 0xe1 && ascii(b, i + 4, 4) === "Exif") return true; // APP1 Exif
    i += 2 + segLen;
  }
  return false;
}

/** RIFF/WebP "EXIF" or "XMP " chunk (GPS rides in EXIF). */
function webpHasMetadata(b: Uint8Array): boolean {
  if (b.length < 16 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return false;
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24);
    if (fourcc === "EXIF" || fourcc === "XMP ") return true;
    i += 8 + size + (size % 2); // chunks are padded to even length
  }
  return false;
}

/** PNG "eXIf" chunk. */
function pngHasExif(b: Uint8Array): boolean {
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return false; // not PNG
  let i = 8;
  while (i + 8 <= b.length) {
    const len = (b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!;
    const type = ascii(b, i + 4, 4);
    if (type === "eXIf") return true;
    if (type === "IDAT" || type === "IEND") break; // metadata precedes image data
    i += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return false;
}

/** True if the image still carries EXIF/GPS/XMP metadata and must be rejected. */
export function hasEmbeddedMetadata(bytes: Uint8Array): boolean {
  return jpegHasExif(bytes) || webpHasMetadata(bytes) || pngHasExif(bytes);
}

/** Accepted image content types (§18.2). */
export function isAcceptedImageType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return ["image/jpeg", "image/png", "image/webp"].includes(contentType.toLowerCase());
}
