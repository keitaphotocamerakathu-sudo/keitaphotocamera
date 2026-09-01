import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inspectVideoRotation, buildRotationPatches } from './mp4-rotation.js';

// Minimal File-like wrapper for Node tests
class NodeFile {
  constructor(buffer) { this.buffer = buffer; this.size = buffer.length; }
  slice(start, end) {
    const buf = this.buffer.subarray(start, end);
    return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
}

function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, 'ascii');
  payload.copy(out, 8);
  return out;
}

function tkhd(rotation = 0) {
  const payload = Buffer.alloc(84); // v0 tkhd payload after 8-byte box header
  payload[0] = 0; // version
  const matrices = {
    0: [65536,0,0,0,65536,0,0,0,1073741824],
    90:[0,65536,0,-65536,0,0,0,0,1073741824],
  };
  matrices[rotation].forEach((v,i) => payload.writeInt32BE(v, 40 + i * 4));
  return box('tkhd', payload);
}

function hdlr(type) {
  const payload = Buffer.alloc(24);
  payload.write(type, 8, 4, 'ascii');
  return box('hdlr', payload);
}

function buildFakeMp4(rotation = 0) {
  const mdia = box('mdia', hdlr('vide'));
  const trak = box('trak', Buffer.concat([tkhd(rotation), mdia]));
  const moov = box('moov', trak);
  const ftyp = box('ftyp', Buffer.from('isom0000'));
  return Buffer.concat([ftyp, moov]);
}

for (const rot of [0, 90]) {
  const file = new NodeFile(buildFakeMp4(rot));
  const info = await inspectVideoRotation(file);
  assert.equal(info.videoTracks.length, 1);
  assert.equal(info.videoTracks[0].rotation, rot);
}

const file = new NodeFile(buildFakeMp4(0));
const built = await buildRotationPatches(file, 90);
assert.equal(built.patches.length, 1);
assert.equal(built.patches[0].bytes.length, 36);

console.log('MP4 rotation parser tests passed');
