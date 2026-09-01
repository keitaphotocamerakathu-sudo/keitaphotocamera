const CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

let core = null;
let loading = null;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

async function ensureCore() {
  if (core) return core;
  if (loading) return loading;

  loading = (async () => {
    post('engine', { status: 'loading' });
    importScripts(CORE_URL);
    if (typeof self.createFFmpegCore !== 'function') {
      throw new Error('โหลด FFmpeg core ไม่สำเร็จ');
    }

    const workerURL = CORE_URL.replace(/\.js$/i, '.worker.js');
    const locator = btoa(JSON.stringify({ wasmURL: WASM_URL, workerURL }));
    const instance = await self.createFFmpegCore({
      mainScriptUrlOrBlob: `${CORE_URL}#${locator}`,
    });

    instance.setLogger(({ message }) => {
      if (message) post('log', { message });
    });
    instance.setProgress(({ progress, time }) => {
      if (Number.isFinite(progress)) post('progress', { progress, time });
    });

    core = instance;
    post('engine', { status: 'ready' });
    return core;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function losslessTrim(file, start, end) {
  const ffmpeg = await ensureCore();
  const duration = Math.max(0.01, end - start);
  const ext = /\.mov$/i.test(file.name) ? '.mov' : '.mp4';
  const inputPath = `/source/${file.name}`;
  const outputPath = `/trimmed${ext}`;

  try { ffmpeg.FS.unmount('/source'); } catch {}
  try { ffmpeg.FS.rmdir('/source'); } catch {}
  try { ffmpeg.FS.mkdir('/source'); } catch {}
  try { ffmpeg.FS.unlink(outputPath); } catch {}

  if (!ffmpeg.FS.filesystems?.WORKERFS) {
    throw new Error('FFmpeg core นี้ไม่มี WORKERFS สำหรับอ่านไฟล์ขนาดใหญ่');
  }

  ffmpeg.FS.mount(ffmpeg.FS.filesystems.WORKERFS, { files: [file] }, '/source');

  try {
    // -ss before -i seeks to the previous keyframe: fast and truly stream-copy/lossless.
    ffmpeg.exec(
      '-ss', start.toFixed(3),
      '-i', inputPath,
      '-t', duration.toFixed(3),
      '-map', '0',
      '-map_metadata', '0',
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outputPath,
    );

    const ret = ffmpeg.ret;
    try { ffmpeg.reset(); } catch {}
    if (ret !== 0) throw new Error(`FFmpeg จบการทำงานด้วยรหัส ${ret}`);
    const out = ffmpeg.FS.readFile(outputPath, { encoding: 'binary' });
    const exact = out.slice();
    return exact.buffer;
  } finally {
    try { ffmpeg.FS.unlink(outputPath); } catch {}
    try { ffmpeg.FS.unmount('/source'); } catch {}
    try { ffmpeg.FS.rmdir('/source'); } catch {}
  }
}

self.onmessage = async (event) => {
  const { id, type } = event.data || {};
  try {
    if (type === 'load') {
      await ensureCore();
      post('result', { id, ok: true });
      return;
    }
    if (type === 'trim') {
      const { file, start, end } = event.data;
      if (!(file instanceof File)) throw new Error('ไม่พบไฟล์สำหรับตัด');
      if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) throw new Error('ช่วงเวลาตัดไม่ถูกต้อง');
      const buffer = await losslessTrim(file, start, end);
      self.postMessage({ type: 'result', id, ok: true, buffer }, [buffer]);
      return;
    }
    throw new Error(`คำสั่ง ${type} ไม่รองรับ`);
  } catch (error) {
    post('result', { id, ok: false, error: error?.message || String(error) });
  }
};
