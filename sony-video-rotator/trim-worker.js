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

  // Give FFmpeg a simple ASCII virtual filename. The browser File still points
  // to the original data and is mounted through WORKERFS, so the video is not
  // copied into WASM memory just to read it.
  const mountedFile = new File([file], virtualName, {
    type: file.type,
    lastModified: file.lastModified,
  });
  ffmpeg.FS.mount(workerFS, { files: [mountedFile] }, '/source');

  try {
    // Sony XAVC S MP4 files can contain a tmcd/data track in addition to
    // video/audio. Mapping every stream with "-map 0" can make the MP4 muxer
    // fail when it tries to copy that data stream. We intentionally map only
    // the first video stream and any audio streams. Both stay stream-copy.
    const primaryArgs = [
      '-nostdin', '-y', '-hide_banner', '-loglevel', 'info',
      '-ss', start.toFixed(3),
      '-i', inputPath,
      '-t', duration.toFixed(3),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-sn', '-dn',
      '-map_metadata', '0',
      '-avoid_negative_ts', 'make_zero',
      '-write_tmcd', '0',
      outputPath,
    ];

    let result = execAndCapture(ffmpeg, primaryArgs);

    // Some camera metadata can still upset a MOV/MP4 muxer. Retry without
    // metadata/chapters, while still copying the original video/audio streams.
    if (result.ret !== 0) {
      const firstLogs = result.logs;
      try { ffmpeg.FS.unlink(outputPath); } catch {}

      const fallbackArgs = [
        '-nostdin', '-y', '-hide_banner', '-loglevel', 'info',
        '-ss', start.toFixed(3),
        '-i', inputPath,
        '-t', duration.toFixed(3),
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-sn', '-dn',
        '-map_metadata', '-1',
        '-map_chapters', '-1',
        '-avoid_negative_ts', 'make_zero',
        '-write_tmcd', '0',
        outputPath,
      ];

      result = execAndCapture(ffmpeg, fallbackArgs);
      if (result.ret !== 0) {
        const detail = summarizeLogs(result.logs) || summarizeLogs(firstLogs);
        throw new Error(
          `FFmpeg ตัดคลิปไม่สำเร็จ (รหัส ${result.ret})` +
          (detail ? `\n${detail}` : '')
        );
      }
    }

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
      if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
        throw new Error('ช่วงเวลาตัดไม่ถูกต้อง');
      }
      const buffer = await losslessTrim(file, start, end);
      self.postMessage({ type: 'result', id, ok: true, buffer }, [buffer]);
      return;
    }
    throw new Error(`คำสั่ง ${type} ไม่รองรับ`);
  } catch (error) {
    post('result', { id, ok: false, error: error?.message || String(error) });
  }
};
