(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KeitaExifCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAGS = Object.freeze({
    Make: 0x010f,
    Model: 0x0110,
    DateTime: 0x0132,
    ExifIFDPointer: 0x8769,
    DateTimeOriginal: 0x9003,
    DateTimeDigitized: 0x9004,
    OffsetTime: 0x9010,
    OffsetTimeOriginal: 0x9011,
    OffsetTimeDigitized: 0x9012,
    PixelXDimension: 0xa002,
    PixelYDimension: 0xa003,
  });

  const TYPE_BYTES = Object.freeze({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 });
  const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  function parseJpegExif(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new TypeError('ต้องใช้ ArrayBuffer');
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const result = {
      hasExif: false,
      width: null,
      height: null,
      make: null,
      model: null,
      dateTime: null,
      dateTimeOriginal: null,
      dateTimeDigitized: null,
      offsetTime: null,
      offsetTimeOriginal: null,
      offsetTimeDigitized: null,
      locations: {},
      warnings: [],
    };

    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      result.warnings.push('ไม่ใช่ JPEG ที่ถูกต้อง');
      return result;
    }

    let pos = 2;
    while (pos + 4 <= bytes.length) {
      while (pos < bytes.length && bytes[pos] !== 0xff) pos++;
      if (pos + 1 >= bytes.length) break;
      while (pos + 1 < bytes.length && bytes[pos + 1] === 0xff) pos++;
      const marker = bytes[pos + 1];

      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2;
        continue;
      }
      if (pos + 4 > bytes.length) break;

      const segLength = view.getUint16(pos + 2, false);
      if (segLength < 2) break;
      const dataStart = pos + 4;
      const segEnd = pos + 2 + segLength;
      if (segEnd > bytes.length) {
        result.warnings.push('ข้อมูล JPEG ส่วน metadata ถูกตัดก่อนจบ segment');
        break;
      }

      if (SOF_MARKERS.has(marker) && dataStart + 5 < segEnd) {
        result.height = view.getUint16(dataStart + 1, false);
        result.width = view.getUint16(dataStart + 3, false);
      }

      if (marker === 0xe1 && segLength >= 8 && isExifHeader(bytes, dataStart)) {
        try {
          parseTiffExif(view, bytes, dataStart + 6, segEnd, result);
          result.hasExif = true;
        } catch (error) {
          result.warnings.push(`อ่าน EXIF ไม่สำเร็จ: ${error.message || error}`);
        }
      }

      pos = segEnd;
    }

    return result;
  }

  function isExifHeader(bytes, offset) {
    return bytes[offset] === 0x45 && bytes[offset + 1] === 0x78 && bytes[offset + 2] === 0x69 && bytes[offset + 3] === 0x66 && bytes[offset + 4] === 0x00 && bytes[offset + 5] === 0x00;
  }

  function parseTiffExif(view, bytes, tiffStart, segmentEnd, result) {
    if (tiffStart + 8 > segmentEnd) throw new Error('TIFF header ไม่ครบ');
    const a = bytes[tiffStart], b = bytes[tiffStart + 1];
    const little = a === 0x49 && b === 0x49;
    const big = a === 0x4d && b === 0x4d;
    if (!little && !big) throw new Error('ไม่รู้จัก byte order ของ TIFF');
    if (view.getUint16(tiffStart + 2, little) !== 42) throw new Error('TIFF magic ไม่ถูกต้อง');

    const read16 = (off) => view.getUint16(off, little);
    const read32 = (off) => view.getUint32(off, little);
    const ifd0Offset = read32(tiffStart + 4);
    const ifd0 = parseIfd(view, bytes, tiffStart, tiffStart + ifd0Offset, segmentEnd, little);

    result.make = readAsciiEntry(bytes, ifd0.get(TAGS.Make));
    result.model = readAsciiEntry(bytes, ifd0.get(TAGS.Model));
    result.dateTime = readAsciiEntry(bytes, ifd0.get(TAGS.DateTime));

    const exifPtrEntry = ifd0.get(TAGS.ExifIFDPointer);
    if (!exifPtrEntry) return;
    const exifOffset = readNumericEntry(view, tiffStart, exifPtrEntry, little);
    if (!Number.isFinite(exifOffset)) return;

    const exifIfd = parseIfd(view, bytes, tiffStart, tiffStart + exifOffset, segmentEnd, little);
    result.dateTimeOriginal = readAsciiEntry(bytes, exifIfd.get(TAGS.DateTimeOriginal));
    result.dateTimeDigitized = readAsciiEntry(bytes, exifIfd.get(TAGS.DateTimeDigitized));
    result.offsetTime = readAsciiEntry(bytes, exifIfd.get(TAGS.OffsetTime));
    result.offsetTimeOriginal = readAsciiEntry(bytes, exifIfd.get(TAGS.OffsetTimeOriginal));
    result.offsetTimeDigitized = readAsciiEntry(bytes, exifIfd.get(TAGS.OffsetTimeDigitized));

    const px = readNumericEntry(view, tiffStart, exifIfd.get(TAGS.PixelXDimension), little);
    const py = readNumericEntry(view, tiffStart, exifIfd.get(TAGS.PixelYDimension), little);
    if (Number.isFinite(px) && px > 0) result.width = px;
    if (Number.isFinite(py) && py > 0) result.height = py;
  }

  function parseIfd(view, bytes, tiffStart, ifdPos, segmentEnd, little) {
    const map = new Map();
    if (!Number.isFinite(ifdPos) || ifdPos < tiffStart || ifdPos + 2 > segmentEnd) return map;
    const count = view.getUint16(ifdPos, little);
    const maxEntries = Math.min(count, Math.floor((segmentEnd - (ifdPos + 2)) / 12));

    for (let i = 0; i < maxEntries; i++) {
      const entryPos = ifdPos + 2 + i * 12;
      if (entryPos + 12 > segmentEnd) break;
      const tag = view.getUint16(entryPos, little);
      const type = view.getUint16(entryPos + 2, little);
      const countValue = view.getUint32(entryPos + 4, little);
      const unit = TYPE_BYTES[type];
      if (!unit || countValue > 16_777_216) continue;
      const byteLength = unit * countValue;
      let valuePos;
      if (byteLength <= 4) valuePos = entryPos + 8;
      else {
        const rel = view.getUint32(entryPos + 8, little);
        valuePos = tiffStart + rel;
      }
      if (valuePos < tiffStart || valuePos + byteLength > segmentEnd) continue;
      map.set(tag, { tag, type, count: countValue, byteLength, entryPos, valuePos });
    }
    return map;
  }


  function readAsciiEntry(bytes, entry) {
    if (!entry || entry.type !== 2 || entry.count < 1) return null;
    const end = Math.min(bytes.length, entry.valuePos + entry.count);
    let s = '';
    for (let i = entry.valuePos; i < end; i++) {
      const c = bytes[i];
      if (c === 0) break;
      if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
      else if (c === 0x09) s += '\t';
    }
    return s.trim() || null;
  }

  function readNumericEntry(view, tiffStart, entry, little) {
    if (!entry || entry.count < 1) return null;
    if (entry.type === 3 && entry.byteLength >= 2) return view.getUint16(entry.valuePos, little);
    if (entry.type === 4 && entry.byteLength >= 4) return view.getUint32(entry.valuePos, little);
    return null;
  }

  // Re-parse with bytes available to bind values/locations cleanly.
  function hydrateAsciiLocations(arrayBuffer, parsed) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return parsed;

    let pos = 2;
    while (pos + 4 <= bytes.length) {
      while (pos < bytes.length && bytes[pos] !== 0xff) pos++;
      if (pos + 1 >= bytes.length) break;
      while (pos + 1 < bytes.length && bytes[pos + 1] === 0xff) pos++;
      const marker = bytes[pos + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      if (pos + 4 > bytes.length) break;
      const segLength = view.getUint16(pos + 2, false);
      if (segLength < 2) break;
      const dataStart = pos + 4;
      const segEnd = pos + 2 + segLength;
      if (segEnd > bytes.length) break;
      if (marker === 0xe1 && segLength >= 8 && isExifHeader(bytes, dataStart)) {
        try {
          hydrateFromTiff(view, bytes, dataStart + 6, segEnd, parsed);
          return parsed;
        } catch (_) { return parsed; }
      }
      pos = segEnd;
    }
    return parsed;
  }

  function hydrateFromTiff(view, bytes, tiffStart, segmentEnd, result) {
    const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
    const read32 = (off) => view.getUint32(off, little);
    const ifd0 = parseIfd(view, bytes, tiffStart, tiffStart + read32(tiffStart + 4), segmentEnd, little);

    bindAscii(bytes, result, 'dateTime', 'dateTime', ifd0.get(TAGS.DateTime));
    result.make = readAsciiEntry(bytes, ifd0.get(TAGS.Make)) || result.make;
    result.model = readAsciiEntry(bytes, ifd0.get(TAGS.Model)) || result.model;

    const exifPtr = ifd0.get(TAGS.ExifIFDPointer);
    const exifOffset = readNumericEntry(view, tiffStart, exifPtr, little);
    if (!Number.isFinite(exifOffset)) return;
    const exifIfd = parseIfd(view, bytes, tiffStart, tiffStart + exifOffset, segmentEnd, little);
    bindAscii(bytes, result, 'dateTimeOriginal', 'dateTimeOriginal', exifIfd.get(TAGS.DateTimeOriginal));
    bindAscii(bytes, result, 'dateTimeDigitized', 'dateTimeDigitized', exifIfd.get(TAGS.DateTimeDigitized));
    bindAscii(bytes, result, 'offsetTime', 'offsetTime', exifIfd.get(TAGS.OffsetTime));
    bindAscii(bytes, result, 'offsetTimeOriginal', 'offsetTimeOriginal', exifIfd.get(TAGS.OffsetTimeOriginal));
    bindAscii(bytes, result, 'offsetTimeDigitized', 'offsetTimeDigitized', exifIfd.get(TAGS.OffsetTimeDigitized));
  }

  function bindAscii(bytes, result, valueKey, locationKey, entry) {
    if (!entry || entry.type !== 2) return;
    result[valueKey] = readAsciiEntry(bytes, entry);
    result.locations[locationKey] = { offset: entry.valuePos, count: entry.count, type: entry.type };
  }

  function inspect(arrayBuffer) {
    const parsed = parseJpegExif(arrayBuffer);
    return hydrateAsciiLocations(arrayBuffer, parsed);
  }

  function patchAscii(arrayBuffer, changes) {
    const parsed = inspect(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer.slice(0));
    let changed = 0;
    const skipped = [];

    for (const [key, value] of Object.entries(changes || {})) {
      if (value == null) continue;
      const loc = parsed.locations[key];
      if (!loc) { skipped.push(key); continue; }
      const text = String(value);
      if (loc.count < text.length + 1) {
        skipped.push(key);
        continue;
      }
      for (let i = 0; i < loc.count; i++) bytes[loc.offset + i] = 0;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code > 0x7f) throw new Error(`ค่า ${key} ต้องเป็น ASCII`);
        bytes[loc.offset + i] = code;
      }
      changed++;
    }

    return { buffer: bytes.buffer, parsed, changed, skipped };
  }

  return { TAGS, inspect, patchAscii };
});
