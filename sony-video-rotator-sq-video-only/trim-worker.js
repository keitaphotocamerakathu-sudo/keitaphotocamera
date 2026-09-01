const CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

let core = null;
let loading = null;
let coreBlobURL = null;
let wasmBlobURL = null;
let activeCommandLog = null;

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
      if (!message) return;
      post('log', { message });
      if (activeCommandLog) {
        activeCommandLog.push(message);
        if (activeCommandLog.length > 120) activeCommandLog.shift();
      }
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

function summarizeLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) return '';
  const important = logs.filter(line =>
    /error|invalid|failed|unsupported|could not|not currently supported|conversion failed|muxer|stream/i.test(line)
  );
  const picked = (important.length ? important : logs).slice(-10);
  return picked.join('\n').trim();
}

function execAndCapture(ffmpeg, args) {
  activeCommandLog = [];
  try {
    ffmpeg.exec(...args);
    return { ret: ffmpeg.ret, logs: activeCommandLog.slice() };
  } finally {
    activeCommandLog = null;
    // This resets ffmpeg's command state, not the virtual filesystem.
    try { ffmpeg.reset(); } catch {}
  }
}

async function losslessTrim(file, start, end) {
  const ffmpeg = await ensureCore();
  const duration = Math.max(0.01, end - start);
  const requestedExt = /\.mov$/i.test(file.name) ? '.mov' : '.mp4';
  const virtualName = safeVirtualName(file.name);
  const inputPath = `/source/${virtualName}`;
  const outputExt = requestedExt;
  const outputPath = `/trimmed${outputExt}`;

  try { ffmpeg.FS.unmount('/source'); } catch {}
  try { ffmpeg.FS.rmdir('/source'); } catch {}
  try { ffmpeg.FS.mkdir('/source'); } catch {}
  try { ffmpeg.FS.unlink(outputPath); } catch {}

  const workerFS = ffmpeg.FS?.filesystems?.WORKERFS;
  if (!workerFS) throw new Error('FFmpeg ไม่มี WORKERFS สำหรับอ่านไฟล์ขนาดใหญ่');

  // Mount the original browser File without copying the whole clip into WASM RAM.
  const mountedFile = new File([file], virtualName, {
    type: file.type,
    lastModified: file.lastModified,
  });
  ffmpeg.FS.mount(workerFS, { files: [mountedFile] }, '/source');

  try {
    // S&Q workflow: export VIDEO ONLY.
    // Sony clips may still contain PCM audio and rtmd/tmcd data tracks even when
    // the slow-motion clip has no useful sound. Copying those streams can make
    // the MP4 muxer fail. We therefore map only the first video stream and copy
    // its encoded H.264 packets unchanged. No video re-encoding is performed.
    const args = [
      '-nostdin', '-y', '-hide_banner', '-loglevel', 'info',
      '-ss', start.toFixed(3),
      '-i', inputPath,
      '-t', duration.toFixed(3),
      '-map', '0:v:0',
      '-c:v', 'copy',
      '-an', '-sn', '-dn',
      '-map_chapters', '-1',
      '-avoid_negative_ts', 'make_zero',
      '-write_tmcd', '0',
      outputPath,
    ];

    const result = execAndCapture(ffmpeg, args);
    if (result.ret !== 0) {
      const detail = summarizeLogs(result.logs);
      throw new Error(
        `FFmpeg ตัดวิดีโอไม่สำเร็จ (รหัส ${result.ret})` +
        (detail ? `\n${detail}` : '')
      );
    }

    const out = ffmpeg.FS.readFile(outputPath, { encoding: 'binary' });
    const exact = out.slice();
    return { buffer: exact.buffer, extension: outputExt };
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
      if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
        throw new Error('ช่วงเวลาตัดไม่ถูกต้อง');
      }
      const result = await losslessTrim(file, start, end);
      self.postMessage(
        { type: 'result', id, ok: true, buffer: result.buffer, extension: result.extension },
        [result.buffer]
      );
      return;
    }
    throw new Error(`คำสั่ง ${type} ไม่รองรับ`);
  } catch (error) {
    post('result', { id, ok: false, error: error?.message || String(error) });
  }
};
