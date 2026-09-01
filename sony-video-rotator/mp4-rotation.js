const MATRIX = {
  0:   [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824],
  90:  [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824],
  180: [-65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824],
  270: [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824],
};

export class Mp4RotationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Mp4RotationError';
  }
}

async function readBytes(file, start, length) {
  const end = Math.min(file.size, start + length);
  if (start < 0 || start >= end) return new Uint8Array();
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function ascii(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

async function readBoxHeader(file, offset, parentEnd = file.size) {
  if (offset + 8 > parentEnd) return null;
  const head = await readBytes(file, offset, 16);
  if (head.length < 8) return null;

  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let size = view.getUint32(0, false);
  const type = ascii(head, 4, 4);
  let headerSize = 8;

  if (size === 1) {
    if (head.length < 16) throw new Mp4RotationError(`กล่อง ${type} มี header ไม่สมบูรณ์`);
    const large = view.getBigUint64(8, false);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Mp4RotationError('ไฟล์มี box ใหญ่เกินขอบเขตที่เว็บรองรับ');
    size = Number(large);
    headerSize = 16;
  } else if (size === 0) {
    size = parentEnd - offset;
  }

  if (size < headerSize || offset + size > parentEnd) {
    throw new Mp4RotationError(`โครงสร้าง MP4 ไม่ถูกต้องที่ ${type}`);
  }

  return { type, start: offset, size, headerSize, end: offset + size };
}

async function children(file, parent) {
  const result = [];
  let offset = parent.start + parent.headerSize;
  while (offset + 8 <= parent.end) {
    const box = await readBoxHeader(file, offset, parent.end);
    if (!box) break;
    result.push(box);
    if (box.size <= 0) break;
    offset = box.end;
  }
  return result;
}

async function findChild(file, parent, type) {
  for (const box of await children(file, parent)) {
    if (box.type === type) return box;
  }
  return null;
}

async function findTopLevel(file, type) {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const box = await readBoxHeader(file, offset, file.size);
    if (!box) break;
    if (box.type === type) return box;
    if (box.size <= 0) break;
    offset = box.end;
  }
  return null;
}

async function handlerType(file, trak) {
  const mdia = await findChild(file, trak, 'mdia');
  if (!mdia) return null;
  const hdlr = await findChild(file, mdia, 'hdlr');
  if (!hdlr || hdlr.size < hdlr.headerSize + 12) return null;
  const bytes = await readBytes(file, hdlr.start + hdlr.headerSize, 12);
  if (bytes.length < 12) return null;
  return ascii(bytes, 8, 4);
}

function matrixToRotation(values) {
  const [a, b, , c, d] = values;
  if (a === 0 && b === 65536 && c === -65536 && d === 0) return 90;
  if (a === 0 && b === -65536 && c === 65536 && d === 0) return 270;
  if (a === -65536 && b === 0 && c === 0 && d === -65536) return 180;
  if (a === 65536 && b === 0 && c === 0 && d === 65536) return 0;
  return null;
}

function matrixBytes(rotation) {
  const values = MATRIX[rotation];
  if (!values) throw new Mp4RotationError(`Rotation ${rotation}° ไม่รองรับ`);
  const out = new Uint8Array(36);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setInt32(i * 4, v, false));
  return out;
}

export async function inspectVideoRotation(file) {
  const moov = await findTopLevel(file, 'moov');
  if (!moov) throw new Mp4RotationError('ไม่พบ moov box — ไฟล์นี้อาจไม่ใช่ MP4/MOV ที่รองรับ');

  const traks = (await children(file, moov)).filter(b => b.type === 'trak');
  if (!traks.length) throw new Mp4RotationError('ไม่พบ track ในไฟล์');

  const videoTracks = [];
  for (const trak of traks) {
    if (await handlerType(file, trak) !== 'vide') continue;
    const tkhd = await findChild(file, trak, 'tkhd');
    if (!tkhd) continue;

    const versionBytes = await readBytes(file, tkhd.start + tkhd.headerSize, 1);
    if (!versionBytes.length) continue;
    const version = versionBytes[0];
    if (version !== 0 && version !== 1) throw new Mp4RotationError(`tkhd version ${version} ยังไม่รองรับ`);

    // Offsets below are relative to the beginning of the tkhd box for normal 8-byte headers.
    // Compensate for 64-bit box headers by replacing the usual 8-byte header with tkhd.headerSize.
    const matrixOffset = tkhd.start + tkhd.headerSize + (version === 1 ? 52 : 40);
    const bytes = await readBytes(file, matrixOffset, 36);
    if (bytes.length < 36) throw new Mp4RotationError('อ่าน transformation matrix ไม่ครบ');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const values = Array.from({ length: 9 }, (_, i) => view.getInt32(i * 4, false));

    videoTracks.push({
      trakStart: trak.start,
      tkhdStart: tkhd.start,
      matrixOffset,
      matrix: values,
      rotation: matrixToRotation(values),
    });
  }

  if (!videoTracks.length) throw new Mp4RotationError('ไม่พบ video track (vide) ในไฟล์');
  return { videoTracks };
}

export async function buildRotationPatches(file, rotation) {
  const info = await inspectVideoRotation(file);
  const bytes = matrixBytes(rotation);
  return {
    info,
    patches: info.videoTracks.map(track => ({
      offset: track.matrixOffset,
      bytes,
    })),
  };
}

export async function copyWithPatches(file, writable, patches, onProgress = () => {}) {
  const ordered = [...patches].sort((a, b) => a.offset - b.offset);
  const reader = file.stream().getReader();
  let absoluteOffset = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = new Uint8Array(value);
      const chunkStart = absoluteOffset;
      const chunkEnd = chunkStart + chunk.length;

      for (const patch of ordered) {
        const patchStart = patch.offset;
        const patchEnd = patch.offset + patch.bytes.length;
        if (patchEnd <= chunkStart || patchStart >= chunkEnd) continue;

        const overlapStart = Math.max(chunkStart, patchStart);
        const overlapEnd = Math.min(chunkEnd, patchEnd);
        const chunkPos = overlapStart - chunkStart;
        const patchPos = overlapStart - patchStart;
        chunk.set(patch.bytes.subarray(patchPos, patchPos + (overlapEnd - overlapStart)), chunkPos);
      }

      await writable.write(chunk);
      absoluteOffset = chunkEnd;
      onProgress(absoluteOffset / file.size);
    }
  } finally {
    reader.releaseLock();
  }
}
