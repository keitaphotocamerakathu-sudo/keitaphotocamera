const CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

let core = null;
let loading = null;
let coreBlobURL = null;
let wasmBlobURL = null;
let activeCommandLog = null;
let activeKeyframes = null;
let activeRequestId = null;

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
        if (activeCommandLog.length > 160) activeCommandLog.shift();
      }
      if (activeKeyframes) {
        const match = message.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/);
        if (match) {
          const value = Number(match[1]);
          if (Number.isFinite(value) && !activeKeyframes.some(v => Math.abs(v - value) < 0.0005)) activeKeyframes.push(value);
        }
      }
    });
    instance.setProgress(({ progress, time }) => {
      if (Number.isFinite(progress)) post('progress', { id: activeRequestId, progress, time });
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



function imageExtension(file, index) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || file?.type === 'image/jpeg') return '.jpg';
  if (name.endsWith('.webp') || file?.type === 'image/webp') return '.webp';
  return '.png';
}

function rotationFilter(rotation) {
  if (rotation === 90) return 'transpose=1';
  if (rotation === 270) return 'transpose=2';
  if (rotation === 180) return 'hflip,vflip';
  return 'null';
}

function watermarkInputFilter(wm, inputIndex, label) {
  const width = Math.max(2, Math.round(Number(wm.width) || 100));
  const opacity = Math.min(1, Math.max(0.01, Number(wm.opacity) || 1));
  const angle = ((Number(wm.angle) || 0) % 360 + 360) % 360;
  let scale;
  let rotate = '';
  if (angle === 90) { scale = `scale=-2:${width}`; rotate = ',transpose=1'; }
  else if (angle === 270) { scale = `scale=-2:${width}`; rotate = ',transpose=2'; }
  else { scale = `scale=${width}:-2`; if (angle === 180) rotate = ',hflip,vflip'; }
  return `[${inputIndex}:v]${scale}${rotate},format=rgba,colorchannelmixer=aa=${opacity.toFixed(4)},setpts=PTS-STARTPTS[${label}]`;
}

async function renderWatermarkedVideo(file, start, end, rotation, watermarks) {
  const ffmpeg = await ensureCore();
  const duration = Math.max(0.01, end - start);
  const virtualName = safeVirtualName(file.name);
  const inputPath = `/source/${virtualName}`;
  const outputPath = '/watermarked.mp4';
  const wmPaths = [];

  try { ffmpeg.FS.unmount('/source'); } catch {}
  try { ffmpeg.FS.rmdir('/source'); } catch {}
  try { ffmpeg.FS.mkdir('/source'); } catch {}
  try { ffmpeg.FS.mkdir('/watermarks'); } catch {}
  try { ffmpeg.FS.unlink(outputPath); } catch {}

  const workerFS = ffmpeg.FS?.filesystems?.WORKERFS;
  if (!workerFS) throw new Error('FFmpeg ไม่มี WORKERFS สำหรับอ่านไฟล์ขนาดใหญ่');
  const mountedFile = new File([file], virtualName, { type: file.type, lastModified: file.lastModified });
  ffmpeg.FS.mount(workerFS, { files: [mountedFile] }, '/source');

  try {
    const args = ['-nostdin', '-y', '-hide_banner', '-loglevel', 'info', '-ss', start.toFixed(3), '-i', inputPath];
    const safeWatermarks = Array.isArray(watermarks) ? watermarks : [];
    for (let i = 0; i < safeWatermarks.length; i++) {
      const wm = safeWatermarks[i];
      if (!(wm.file instanceof Blob)) throw new Error(`ลายน้ำชิ้นที่ ${i + 1} ไม่มีไฟล์รูปภาพ`);
      const ext = imageExtension(wm.file, i);
      const path = `/watermarks/wm${i}${ext}`;
      ffmpeg.FS.writeFile(path, new Uint8Array(await wm.file.arrayBuffer()));
      wmPaths.push(path);
      args.push('-i', path);
    }

    const filters = [];
    filters.push(`[0:v]${rotationFilter(rotation)},setpts=PTS-STARTPTS[base0]`);
    let current = 'base0';
    safeWatermarks.forEach((wm, i) => {
      const wmLabel = `wm${i}`;
      const outLabel = `base${i + 1}`;
      filters.push(watermarkInputFilter(wm, i + 1, wmLabel));
      const x = Math.round(Number(wm.x) || 0);
      const y = Math.round(Number(wm.y) || 0);
      filters.push(`[${current}][${wmLabel}]overlay=x=${x}:y=${y}:eof_action=repeat:repeatlast=1:format=auto[${outLabel}]`);
      current = outLabel;
    });
    filters.push(`[${current}]format=yuv420p[outv]`);

    args.push(
      '-t', duration.toFixed(3),
      '-filter_complex', filters.join(';'),
      '-map', '[outv]',
      '-an', '-sn', '-dn',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '16',
      '-pix_fmt', 'yuv420p',
      '-metadata:s:v:0', 'rotate=0',
      '-movflags', '+faststart',
      outputPath
    );

    const result = execAndCapture(ffmpeg, args);
    if (result.ret !== 0) {
      const detail = summarizeLogs(result.logs);
      throw new Error(`FFmpeg ใส่ลายน้ำไม่สำเร็จ (รหัส ${result.ret})${detail ? `\n${detail}` : ''}`);
    }
    const out = ffmpeg.FS.readFile(outputPath, { encoding: 'binary' });
    const exact = out.slice();
    return { buffer: exact.buffer, extension: '.mp4' };
  } finally {
    try { ffmpeg.FS.unlink(outputPath); } catch {}
    for (const path of wmPaths) try { ffmpeg.FS.unlink(path); } catch {}
    try { ffmpeg.FS.rmdir('/watermarks'); } catch {}
    try { ffmpeg.FS.unmount('/source'); } catch {}
    try { ffmpeg.FS.rmdir('/source'); } catch {}
  }
}

async function inspectKeyframes(file) {
  const ffmpeg = await ensureCore();
  const virtualName = safeVirtualName(file.name);
  const inputPath = `/source/${virtualName}`;

  try { ffmpeg.FS.unmount('/source'); } catch {}
  try { ffmpeg.FS.rmdir('/source'); } catch {}
  try { ffmpeg.FS.mkdir('/source'); } catch {}

  const workerFS = ffmpeg.FS?.filesystems?.WORKERFS;
  if (!workerFS) throw new Error('FFmpeg ไม่มี WORKERFS สำหรับอ่านไฟล์ขนาดใหญ่');
  const mountedFile = new File([file], virtualName, { type: file.type, lastModified: file.lastModified });
  ffmpeg.FS.mount(workerFS, { files: [mountedFile] }, '/source');

  activeCommandLog = [];
  activeKeyframes = [];
  try {
    ffmpeg.exec(
      '-nostdin', '-hide_banner', '-loglevel', 'info',
      '-skip_frame', 'nokey',
      '-i', inputPath,
      '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', 'showinfo',
      '-f', 'null', '-'
    );
    const ret = ffmpeg.ret;
    const logs = activeCommandLog.slice();
    const keyframes = activeKeyframes.slice().sort((a,b) => a-b);
    if (ret !== 0) {
      const detail = summarizeLogs(logs);
      throw new Error(`วิเคราะห์ Keyframe ไม่สำเร็จ (รหัส ${ret})${detail ? `\n${detail}` : ''}`);
    }
    return keyframes;
  } finally {
    activeCommandLog = null;
    activeKeyframes = null;
    try { ffmpeg.reset(); } catch {}
    try { ffmpeg.FS.unmount('/source'); } catch {}
    try { ffmpeg.FS.rmdir('/source'); } catch {}
  }
}

self.onmessage = async (event) => {
  const { id, type } = event.data || {};
  activeRequestId = id || null;
  try {
    if (type === 'load') {
      await ensureCore();
      post('result', { id, ok: true });
      return;
    }
    if (type === 'keyframes') {
      const { file } = event.data;
      if (!(file instanceof File)) throw new Error('ไม่พบไฟล์สำหรับวิเคราะห์ Keyframe');
      const keyframes = await inspectKeyframes(file);
      post('result', { id, ok: true, keyframes });
      return;
    }
    if (type === 'watermark') {
      const { file, start, end, rotation, watermarks } = event.data;
      if (!(file instanceof File)) throw new Error('ไม่พบไฟล์สำหรับใส่ลายน้ำ');
      if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) throw new Error('ช่วงเวลาตัดไม่ถูกต้อง');
      if (!Array.isArray(watermarks) || !watermarks.length) throw new Error('ยังไม่มีลายน้ำ');
      const result = await renderWatermarkedVideo(file, start, end, rotation, watermarks);
      self.postMessage({ type: 'result', id, ok: true, buffer: result.buffer, extension: result.extension }, [result.buffer]);
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
  } finally {
    activeRequestId = null;
  }
};
