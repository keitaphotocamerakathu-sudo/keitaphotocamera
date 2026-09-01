const CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

let core = null;
let loading = null;
let coreBlobURL = null;
let wasmBlobURL = null;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

async function fetchAsBlobURL(url, type) {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`โหลด ${url.split('/').pop()} ไม่สำเร็จ (${response.status})`);
  const buffer = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([buffer], { type }));
}

async function ensureCore() {
  if (core) return core;
  if (loading) return loading;

  loading = (async () => {
    post('engine', { status: 'loading' });

    // FFmpeg.wasm recommends turning CDN assets into same-origin blob URLs
    // to avoid CORS/locateFile failures in browsers.
    coreBlobURL = coreBlobURL || await fetchAsBlobURL(CORE_URL, 'text/javascript');
    wasmBlobURL = wasmBlobURL || await fetchAsBlobURL(WASM_URL, 'application/wasm');

    importScripts(coreBlobURL);
    if (typeof self.createFFmpegCore !== 'function') {
      throw new Error('โหลด FFmpeg core ไม่สำเร็จ');
    }

    const locator = btoa(JSON.stringify({ wasmURL: wasmBlobURL }));
    const instance = await self.createFFmpegCore({
      mainScriptUrlOrBlob: `${coreBlobURL}#${locator}`,
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

function safeVirtualName(name) {
  const ext = /\.mov$/i.test(name) ? '.mov' : '.mp4';
  return `input${ext}`;
}

async function losslessTrim(file, start, end) {
  const ffmpeg = await ensureCore();
  const duration = Math.max(0.01, end - start);
  const ext = /\.mov$/i.test(file.name) ? '.mov' : '.mp4';
  const virtualName = safeVirtualName(file.name);
  const inputPath = `/source/${virtualName}`;
  const outputPath = `/trimmed${ext}`;

  try { ffmpeg.FS.unmount('/source'); } catch {}
  try { ffmpeg.FS.rmdir('/source'); } catch {}
  try { ffmpeg.FS.mkdir('/source'); } catch {}
  try { ffmpeg.FS.unlink(outputPath); } catch {}

  const workerFS = ffmpeg.FS?.filesystems?.WORKERFS;
  if (!workerFS) throw new Error('FFmpeg ไม่มี WORKERFS สำหรับอ่านไฟล์ขนาดใหญ่');

  // Rename only inside FFmpeg's virtual mount to avoid path/Unicode quirks.
  const mountedFile = new File([file], virtualName, { type: file.type, lastModified: file.lastModified });
  ffmpeg.FS.mount(workerFS, { files: [mountedFile] }, '/source');

  try {
    ffmpeg.exec(
      '-ss', start.toFixed(3),
      '-i', inputPath,
      '-t', duration.toFixed(3),
      '-map', '0',
      '-map_metadata', '0',
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      outputPath,
    );

    const ret = ffmpeg.ret;
    if (ret !== 0) throw new Error(`FFmpeg จบการทำงานด้วยรหัส ${ret}`);

    // Read output BEFORE reset/cleanup.
    const out = ffmpeg.FS.readFile(outputPath, { encoding: 'binary' });
    const exact = out.slice();
    try { ffmpeg.reset(); } catch {}
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
