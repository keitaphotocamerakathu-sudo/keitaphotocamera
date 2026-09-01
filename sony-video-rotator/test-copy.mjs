import assert from 'node:assert/strict';
import { inspectVideoRotation, buildRotationPatches, copyWithPatches } from './mp4-rotation.js';

function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, 'ascii');
  payload.copy(out, 8);
  return out;
}
function tkhd() {
  const payload = Buffer.alloc(84);
  const m=[65536,0,0,0,65536,0,0,0,1073741824];
  m.forEach((v,i)=>payload.writeInt32BE(v,40+i*4));
  return box('tkhd',payload);
}
function hdlr(){ const p=Buffer.alloc(24); p.write('vide',8,4,'ascii'); return box('hdlr',p); }
const original = Buffer.concat([box('ftyp',Buffer.from('isom0000')), box('moov', box('trak',Buffer.concat([tkhd(),box('mdia',hdlr())])))]);
const blob = new Blob([original]);
const {patches}=await buildRotationPatches(blob,90);
const chunks=[];
const writable={write:async c=>chunks.push(Buffer.from(c)),close:async()=>{}};
await copyWithPatches(blob,writable,patches);
const output = new Blob(chunks);
const info=await inspectVideoRotation(output);
assert.equal(info.videoTracks[0].rotation,90);
assert.equal(output.size,blob.size);
console.log('Streaming patch test passed');
