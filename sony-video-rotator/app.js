import { inspectVideoRotation, buildRotationPatches, copyWithPatches } from './mp4-rotation.js';

const $ = (s) => document.querySelector(s);
const els = {
  chooseFolderBtn: $('#chooseFolderBtn'),
  startBtn: $('#startBtn'),
  cancelBtn: $('#cancelBtn'),
  openOutputBtn: $('#openOutputBtn'),
  browserWarning: $('#browserWarning'),
  folderName: $('#folderName'),
  fileCount: $('#fileCount'),
  totalSize: $('#totalSize'),
  fileList: $('#fileList'),
  selectedCount: $('#selectedCount'),
  selectAllBtn: $('#selectAllBtn'),
  selectNoneBtn: $('#selectNoneBtn'),
  previewVideo: $('#previewVideo'),
  emptyPreview: $('#emptyPreview'),
  previewMeta: $('#previewMeta'),
  previewIndex: $('#previewIndex'),
  prevBtn: $('#prevBtn'),
  nextBtn: $('#nextBtn'),
  progressBar: $('#progressBar'),
  progressText: $('#progressText'),
  progressCount: $('#progressCount'),
  processMessage: $('#processMessage'),
  previewRotationText: $('#previewRotationText'),
  rotateLeftBtn: $('#rotateLeftBtn'),
  rotateResetBtn: $('#rotateResetBtn'),
  rotateRightBtn: $('#rotateRightBtn'),
  rotate180Btn: $('#rotate180Btn'),
  trimEnabled: $('#trimEnabled'),
  trimTimeline: $('#trimTimeline'),
  trimFilmstrip: $('#trimFilmstrip'),
  trimSelection: $('#trimSelection'),
  trimStartHandle: $('#trimStartHandle'),
  trimEndHandle: $('#trimEndHandle'),
  trimPlayhead: $('#trimPlayhead'),
  storyDurationText: $('#storyDurationText'),
  startRange: $('#startRange'),
  endRange: $('#endRange'),
  trimStartText: $('#trimStartText'),
  trimEndText: $('#trimEndText'),
  currentTimeText: $('#currentTimeText'),
  selectedDuration: $('#selectedDuration'),
  setStartBtn: $('#setStartBtn'),
  setEndBtn: $('#setEndBtn'),
  jumpStartBtn: $('#jumpStartBtn'),
  jumpEndBtn: $('#jumpEndBtn'),
  clearTrimBtn: $('#clearTrimBtn'),
  previewSelectionBtn: $('#previewSelectionBtn'),
  clipName: $('#clipName'),
  clipDuration: $('#clipDuration'),
  clipExportRange: $('#clipExportRange'),
  clipTrimStatus: $('#clipTrimStatus'),
  clipSelected: $('#clipSelected'),
};

const state = {
  dirHandle: null,
  outputDirHandle: null,
  files: [],
  rotation: 0,
  previewIndex: 0,
  previewUrl: null,
  processing: false,
  cancelRequested: false,
  previewingSelection: false,
  trimWorker: null,
  trimWorkerRequests: new Map(),
  trimWorkerSeq: 0,
  timelineGeneration: 0,
};

const supported = 'showDirectoryPicker' in window && window.isSecureContext;
if (!supported) {
  els.browserWarning.classList.remove('hidden');
  els.chooseFolderBtn.disabled = true;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const ms = Math.floor((seconds % 1) * 1000);
  const whole = Math.floor(seconds);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  const base = h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${base}.${String(ms).padStart(3, '0')}`;
}

function rotationLabel(rotation) {
  if (rotation === 0) return '0°';
  if (rotation === 90) return '90° ขวา';
  if (rotation === 180) return '180°';
  if (rotation === 270) return '90° ซ้าย';
  return 'ไม่ทราบ';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
}

function currentItem() {
  return state.files[state.previewIndex] || null;
}


async function readMediaDuration(item, timeoutMs = 15000) {
  if (Number.isFinite(item?.duration) && item.duration > 0) return item.duration;
  const file = await item.handle.getFile();
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  try {
    const duration = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('durationchange', onLoaded);
        video.removeEventListener('error', onError);
        fn(value);
      };
      const onLoaded = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) finish(resolve, video.duration);
      };
      const onError = () => finish(reject, new Error('อ่านความยาววิดีโอไม่ได้'));
      const timer = setTimeout(() => finish(reject, new Error('อ่านความยาววิดีโอหมดเวลา')), timeoutMs);
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('durationchange', onLoaded);
      video.addEventListener('error', onError);
      video.src = url;
      video.load();
    });

    item.duration = duration;
    item.trimStart = clamp(Number.isFinite(item.trimStart) ? item.trimStart : 0, 0, duration);
    if (!Number.isFinite(item.trimEnd) || item.trimEnd <= item.trimStart || item.trimEnd > duration) item.trimEnd = duration;
    item.trimEnabled = true;
    return duration;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function inspectAllDurations() {
  let done = 0;
  for (const item of state.files) {
    try {
      await readMediaDuration(item);
      if (item.status === 'metadata-error') item.status = 'ready';
    } catch (error) {
      item.error = `อ่านความยาวไม่ได้: ${error.message || error}`;
      item.status = 'metadata-error';
    }
    done++;
    els.processMessage.textContent = `กำลังอ่านช่วงเวลาคลิป ${done} / ${state.files.length}`;
    renderFiles();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function percentOf(value, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return clamp((value / total) * 100, 0, 100);
}

function resetFilmstrip(count = 10) {
  const safeCount = clamp(Math.round(count || 10), 6, 14);
  els.trimFilmstrip.style.setProperty('--frame-count', safeCount);
  els.trimFilmstrip.innerHTML = Array.from({ length: safeCount }, () => '<div class="story-frame placeholder"></div>').join('');
}

function waitForMediaEvent(media, eventName, timeout = 6000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      media.removeEventListener(eventName, onDone);
      media.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onDone = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('อ่านเฟรมตัวอย่างไม่ได้')); };
    media.addEventListener(eventName, onDone, { once: true });
    media.addEventListener('error', onError, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error('หมดเวลารอเฟรมตัวอย่าง')); }, timeout);
  });
}

async function generateFilmstrip(item, sourceUrl) {
  const generation = ++state.timelineGeneration;
  const count = clamp(Math.round((els.trimTimeline.clientWidth || 760) / 88), 7, 12);
  resetFilmstrip(count);

  if (!item || !Number.isFinite(item.duration) || item.duration <= 0 || !sourceUrl) return;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = sourceUrl;

  try {
    if (video.readyState < 2) await waitForMediaEvent(video, 'loadeddata');
    const canvas = document.createElement('canvas');
    canvas.width = 176;
    canvas.height = 100;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas ใช้งานไม่ได้');

    const frames = [];
    for (let i = 0; i < count; i++) {
      if (generation !== state.timelineGeneration || currentItem() !== item) return;
      const time = Math.min(Math.max(0.03, item.duration * ((i + 0.5) / count)), Math.max(0.03, item.duration - 0.03));
      if (Math.abs(video.currentTime - time) > 0.015) {
        video.currentTime = time;
        await waitForMediaEvent(video, 'seeked');
      }

      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const targetRatio = canvas.width / canvas.height;
      const sourceRatio = vw / vh;
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (sourceRatio > targetRatio) {
        sw = vh * targetRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / targetRatio;
        sy = (vh - sh) / 2;
      }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.62));
    }

    if (generation !== state.timelineGeneration || currentItem() !== item) return;
    els.trimFilmstrip.style.setProperty('--frame-count', frames.length);
    els.trimFilmstrip.innerHTML = frames.map(src => `<div class="story-frame" style="background-image:url('${src}')"></div>`).join('');
  } catch (error) {
    console.warn('Filmstrip preview:', error);
    if (generation === state.timelineGeneration) resetFilmstrip(count);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

function updateStoryTimeline() {
  const item = currentItem();
  if (!item || !Number.isFinite(item.duration) || item.duration <= 0) {
    els.trimTimeline.style.setProperty('--start-pct', '0%');
    els.trimTimeline.style.setProperty('--end-pct', '100%');
    els.trimTimeline.style.setProperty('--play-pct', '0%');
    if (els.storyDurationText) els.storyDurationText.textContent = '00:00.000';
    return;
  }
  const start = clamp(item.trimStart || 0, 0, item.duration);
  const end = clamp(Number.isFinite(item.trimEnd) ? item.trimEnd : item.duration, start, item.duration);
  const play = clamp(els.previewVideo.currentTime || 0, 0, item.duration);
  els.trimTimeline.style.setProperty('--start-pct', `${percentOf(start, item.duration)}%`);
  els.trimTimeline.style.setProperty('--end-pct', `${percentOf(end, item.duration)}%`);
  els.trimTimeline.style.setProperty('--play-pct', `${percentOf(play, item.duration)}%`);
  if (els.storyDurationText) els.storyDurationText.textContent = formatTime(end - start);
}

function timelineTimeFromClientX(clientX) {
  const item = currentItem();
  if (!item?.duration) return 0;
  const rect = els.trimTimeline.getBoundingClientRect();
  const ratio = rect.width ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  return ratio * item.duration;
}

function enableTrimForCurrent() {
  const item = currentItem();
  if (!item) return;
  item.trimEnabled = true;
  els.trimEnabled.checked = true;
}

function selectedFiles() {
  return state.files.filter(item => item.selected !== false);
}

function updateSelectionUI() {
  const selected = selectedFiles().length;
  const total = state.files.length;
  if (els.selectedCount) els.selectedCount.textContent = `${selected} / ${total} ไฟล์`;
  if (els.selectAllBtn) els.selectAllBtn.disabled = !total || state.processing || selected === total;
  if (els.selectNoneBtn) els.selectNoneBtn.disabled = !total || state.processing || selected === 0;
  if (els.startBtn) {
    els.startBtn.disabled = selected === 0 || state.processing;
    els.startBtn.textContent = selected ? `Export ที่เลือก (${selected})` : 'เลือกไฟล์ก่อน Export';
  }
}

function statusText(item) {
  if (item.selected === false) return 'ไม่ Export';
  if (item.error) return `ผิดพลาด: ${item.error}`;
  if (item.status === 'processing') return 'กำลังทำ…';
  if (item.status === 'done') return '✓ เสร็จแล้ว';
  return 'พร้อม';
}

function trimText(item) {
  if (!Number.isFinite(item.duration)) return 'กำลังอ่านช่วงตัด…';
  return `${formatTime(item.trimStart)}–${formatTime(item.trimEnd)}`;
}

function renderFiles() {
  if (!state.files.length) {
    els.fileList.innerHTML = '<div class="empty-list">ยังไม่มีไฟล์</div>';
    updateSelectionUI();
    return;
  }
  els.fileList.innerHTML = state.files.map((item, i) => `
    <div class="file-row ${i === state.previewIndex ? 'active' : ''} ${item.selected === false ? 'excluded' : ''}">
      <label class="file-select" title="${item.selected === false ? 'เลือกไฟล์นี้เพื่อ Export' : 'ไม่ Export ไฟล์นี้'}">
        <input class="file-select-input" type="checkbox" data-select-index="${i}" ${item.selected === false ? '' : 'checked'} ${state.processing ? 'disabled' : ''} />
        <span class="file-checkmark" aria-hidden="true">✓</span>
      </label>
      <button class="file-open" data-index="${i}" type="button">
        <div class="file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="file-size">${formatBytes(item.size)}</div>
        <div class="file-trim">${trimText(item)}</div>
        <div class="file-rotation">${item.inspecting ? 'กำลังอ่าน…' : rotationLabel(item.currentRotation)}</div>
        <div class="file-status ${item.status || 'ready'}">${statusText(item)}</div>
      </button>
    </div>
  `).join('');
  els.fileList.querySelectorAll('.file-open').forEach(row => {
    row.addEventListener('click', () => showPreview(Number(row.dataset.index)));
  });
  els.fileList.querySelectorAll('.file-select-input').forEach(input => {
    input.addEventListener('change', () => {
      const item = state.files[Number(input.dataset.selectIndex)];
      if (!item || state.processing) return;
      item.selected = input.checked;
      if (Number(input.dataset.selectIndex) === state.previewIndex) updateTrimUI();
      renderFiles();
      updateSummary();
      resetProgress();
    });
  });
  updateSelectionUI();
}

function updateSummary() {
  const total = state.files.reduce((sum, f) => sum + f.size, 0);
  els.folderName.textContent = state.dirHandle?.name || '—';
  els.fileCount.textContent = `${state.files.length} ไฟล์`;
  els.totalSize.textContent = formatBytes(total);
  updateSelectionUI();
  els.prevBtn.disabled = state.files.length <= 1 || state.processing;
  els.nextBtn.disabled = state.files.length <= 1 || state.processing;
}

async function loadFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'sony-video-rotator-source' });
    state.dirHandle = dirHandle;
    state.outputDirHandle = null;
    state.files = [];
    state.previewIndex = 0;

    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== 'file' || !/\.(mp4|mov)$/i.test(name)) continue;
      const file = await handle.getFile();
      state.files.push({
        name,
        handle,
        size: file.size,
        lastModified: file.lastModified,
        currentRotation: null,
        inspecting: true,
        status: 'ready',
        error: null,
        duration: null,
        trimStart: 0,
        trimEnd: null,
        trimEnabled: true,
        selected: true,
      });
    }

    state.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    updateSummary();
    renderFiles();
    resetProgress();

    if (!state.files.length) {
      clearPreview();
      els.processMessage.textContent = 'ไม่พบไฟล์ .MP4 หรือ .MOV ในโฟลเดอร์นี้';
      return;
    }

    els.processMessage.textContent = 'กำลังตรวจ Rotation metadata ของไฟล์…';
    await inspectAllFiles();
    els.processMessage.textContent = 'กำลังอ่านความยาวของทุกคลิป…';
    await inspectAllDurations();
    await showPreview(0);
    els.processMessage.textContent = 'พร้อมแล้ว — ตั้งช่วงตัด แล้วเลือกเฉพาะไฟล์ที่ต้องการ Export';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error(error);
    alert(`เลือกโฟลเดอร์ไม่สำเร็จ: ${error.message || error}`);
  }
}

async function inspectAllFiles() {
  for (const item of state.files) {
    try {
      const file = await item.handle.getFile();
      const result = await inspectVideoRotation(file);
      const rotations = result.videoTracks.map(t => t.rotation).filter(r => r !== null);
      item.currentRotation = rotations.length ? rotations[0] : null;
      item.error = null;
    } catch (error) {
      item.error = error.message || String(error);
    } finally {
      item.inspecting = false;
      renderFiles();
    }
  }
}

function clearPreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  state.timelineGeneration++;
  resetFilmstrip();
  els.previewVideo.removeAttribute('src');
  els.previewVideo.load();
  els.previewVideo.style.display = 'none';
  els.emptyPreview.classList.remove('hidden');
  els.previewMeta.textContent = 'เลือกโฟลเดอร์เพื่อเริ่มแก้ไขคลิป';
  els.previewIndex.textContent = '0 / 0';
  setTrimControlsEnabled(false);
  if (els.clipSelected) { els.clipSelected.disabled = true; els.clipSelected.checked = false; }
  updateTrimUI();
}

async function showPreview(index) {
  if (!state.files.length) return clearPreview();
  state.previewingSelection = false;
  state.previewIndex = (index + state.files.length) % state.files.length;
  const item = currentItem();
  const file = await item.handle.getFile();

  els.previewVideo.pause();
  state.timelineGeneration++;
  resetFilmstrip();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(file);
  els.previewVideo.src = state.previewUrl;
  els.previewVideo.style.display = 'block';
  els.emptyPreview.classList.add('hidden');
  els.previewMeta.textContent = `${item.name} · ${formatBytes(item.size)} · Rotation ปัจจุบัน ${rotationLabel(item.currentRotation)}`;
  els.previewIndex.textContent = `${state.previewIndex + 1} / ${state.files.length}`;
  els.clipName.textContent = item.name;
  if (els.clipSelected) { els.clipSelected.disabled = state.processing; els.clipSelected.checked = item.selected !== false; }
  applyPreviewRotation();
  renderFiles();

  await new Promise(resolve => {
    if (els.previewVideo.readyState >= 1 && Number.isFinite(els.previewVideo.duration)) return resolve();
    const done = () => resolve();
    els.previewVideo.addEventListener('loadedmetadata', done, { once: true });
    els.previewVideo.addEventListener('error', done, { once: true });
  });

  if (Number.isFinite(els.previewVideo.duration)) {
    item.duration = els.previewVideo.duration;
    if (!Number.isFinite(item.trimEnd) || item.trimEnd <= 0 || item.trimEnd > item.duration) item.trimEnd = item.duration;
    item.trimStart = Math.min(Math.max(0, item.trimStart || 0), Math.max(0, item.trimEnd - 0.01));
    setTrimControlsEnabled(true);
    updateTrimUI();
    renderFiles();
    generateFilmstrip(item, state.previewUrl);
  } else {
    setTrimControlsEnabled(false);
    els.selectedDuration.textContent = 'อ่านความยาวคลิปไม่ได้';
  }
}

function setTrimControlsEnabled(enabled) {
  const disabled = !enabled || state.processing;
  for (const el of [els.startRange, els.endRange, els.setStartBtn, els.setEndBtn, els.jumpStartBtn, els.jumpEndBtn, els.clearTrimBtn, els.previewSelectionBtn, els.trimStartHandle, els.trimEndHandle]) {
    el.disabled = disabled;
  }
  if (els.trimEnabled) {
    els.trimEnabled.checked = true;
    els.trimEnabled.disabled = true;
  }
  els.trimTimeline.classList.toggle('disabled', disabled);
}

function updateTrimUI() {
  const item = currentItem();
  if (!item || !Number.isFinite(item.duration)) {
    els.trimStartText.textContent = '00:00.000';
    els.trimEndText.textContent = '00:00.000';
    els.currentTimeText.textContent = '00:00.000';
    els.selectedDuration.textContent = 'ยังไม่ได้เลือกคลิป';
    els.clipDuration.textContent = '—';
    els.clipExportRange.textContent = 'ทั้งคลิป';
    els.clipTrimStatus.textContent = 'ไม่ตัด';
    if (els.clipSelected) { els.clipSelected.checked = false; els.clipSelected.disabled = true; }
    updateStoryTimeline();
    return;
  }

  const end = Math.min(item.duration, Number.isFinite(item.trimEnd) ? item.trimEnd : item.duration);
  const start = Math.min(Math.max(0, item.trimStart || 0), Math.max(0, end - 0.01));
  item.trimStart = start;
  item.trimEnd = end;

  els.startRange.max = item.duration;
  els.endRange.max = item.duration;
  els.startRange.value = start;
  els.endRange.value = end;
  item.trimEnabled = true;
  els.trimEnabled.checked = true;
  els.trimStartText.textContent = formatTime(start);
  els.trimEndText.textContent = formatTime(end);
  els.currentTimeText.textContent = formatTime(els.previewVideo.currentTime || 0);
  els.selectedDuration.textContent = `ช่วงที่เลือก ${formatTime(end - start)}`;
  els.clipDuration.textContent = formatTime(item.duration);
  els.clipExportRange.textContent = `${formatTime(start)} → ${formatTime(end)}`;
  els.clipTrimStatus.textContent = '✓ ตัดทุกคลิปแบบ Lossless';
  if (els.clipSelected) { els.clipSelected.checked = item.selected !== false; els.clipSelected.disabled = state.processing; }
  updateStoryTimeline();
}

function setTrimStart(value, seek = false) {
  const item = currentItem();
  if (!item?.duration) return;
  const maxStart = Math.max(0, item.trimEnd - 0.05);
  item.trimStart = Math.min(Math.max(0, value), maxStart);
  if (seek) els.previewVideo.currentTime = item.trimStart;
  updateTrimUI();
  renderFiles();
}

function setTrimEnd(value, seek = false) {
  const item = currentItem();
  if (!item?.duration) return;
  const minEnd = Math.min(item.duration, item.trimStart + 0.05);
  item.trimEnd = Math.max(minEnd, Math.min(item.duration, value));
  if (seek) els.previewVideo.currentTime = item.trimEnd;
  updateTrimUI();
  renderFiles();
}

function applyPreviewRotation() {
  const r = state.rotation;
  const cssRotation = r === 270 ? -90 : r;
  els.previewVideo.style.transform = `rotate(${cssRotation}deg)`;
  els.previewVideo.classList.toggle('sideways', r === 90 || r === 270);
  els.previewRotationText.textContent = r === 0 ? 'ยังไม่หมุน' : rotationLabel(r);
  const buttonMap = { 270: els.rotateLeftBtn, 0: els.rotateResetBtn, 90: els.rotateRightBtn, 180: els.rotate180Btn };
  document.querySelectorAll('.rotate-btn').forEach(btn => btn.classList.remove('active'));
  buttonMap[r]?.classList.add('active');
}

function setRotation(rotation) {
  state.rotation = rotation;
  applyPreviewRotation();
}

function resetProgress() {
  els.progressBar.style.width = '0%';
  els.progressText.textContent = '0%';
  els.progressCount.textContent = `0 / ${selectedFiles().length}`;
  els.openOutputBtn.classList.add('hidden');
  els.cancelBtn.classList.add('hidden');
}

function setOverallProgress(fileIndex, withinFile, totalFiles) {
  const total = totalFiles || 1;
  const overall = Math.min(1, (fileIndex + withinFile) / total);
  const pct = Math.round(overall * 100);
  els.progressBar.style.width = `${pct}%`;
  els.progressText.textContent = `${pct}%`;
  els.progressCount.textContent = `${Math.min(fileIndex + (withinFile >= 1 ? 1 : 0), total)} / ${total}`;
}

function outputName(item) {
  const match = item.name.match(/^(.*?)(\.[^.]+)$/);
  return match ? `${match[1]}_cut${match[2]}` : `${item.name}_cut.mp4`;
}

function getTrimWorker() {
  if (state.trimWorker) return state.trimWorker;
  const worker = new Worker('./trim-worker.js');
  worker.addEventListener('message', event => {
    const msg = event.data || {};
    if (msg.type === 'engine') {
      if (msg.status === 'loading') els.processMessage.textContent = 'กำลังโหลดเครื่องมือตัดแบบ Lossless…';
      return;
    }
    if (msg.type === 'progress') return;
    if (msg.type !== 'result') return;
    const req = state.trimWorkerRequests.get(msg.id);
    if (!req) return;
    state.trimWorkerRequests.delete(msg.id);
    if (msg.ok) req.resolve(msg.buffer ?? true);
    else req.reject(new Error(msg.error || 'ตัดวิดีโอไม่สำเร็จ'));
  });
  worker.addEventListener('error', event => {
    for (const req of state.trimWorkerRequests.values()) req.reject(new Error(event.message || 'FFmpeg Worker มีข้อผิดพลาด'));
    state.trimWorkerRequests.clear();
  });
  state.trimWorker = worker;
  return worker;
}

function workerRequest(type, payload = {}) {
  const worker = getTrimWorker();
  const id = ++state.trimWorkerSeq;
  return new Promise((resolve, reject) => {
    state.trimWorkerRequests.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload });
  });
}

async function trimLossless(file, start, end) {
  const buffer = await workerRequest('trim', { file, start, end });
  return new Blob([buffer], { type: file.type || (/\.mov$/i.test(file.name) ? 'video/quicktime' : 'video/mp4') });
}

async function writeRotatedSource(sourceBlob, outHandle, rotation, onProgress) {
  const { patches } = await buildRotationPatches(sourceBlob, rotation);
  const writable = await outHandle.createWritable();
  try {
    await copyWithPatches(sourceBlob, writable, patches, onProgress);
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch {}
    throw error;
  }
}

async function processAll() {
  const exportFiles = selectedFiles();
  if (!state.dirHandle || !exportFiles.length || state.processing) return;
  state.processing = true;
  if (els.clipSelected) els.clipSelected.disabled = true;
  updateSelectionUI();
  state.cancelRequested = false;
  state.previewingSelection = false;
  els.previewVideo.pause();
  els.cancelBtn.disabled = false;
  els.cancelBtn.textContent = 'ยกเลิกหลังจบไฟล์ปัจจุบัน';
  els.startBtn.disabled = true;
  els.chooseFolderBtn.disabled = true;
  els.cancelBtn.classList.remove('hidden');
  els.openOutputBtn.classList.add('hidden');
  setTrimControlsEnabled(false);

  try {
    state.outputDirHandle = await state.dirHandle.getDirectoryHandle('Output', { create: true });
    let completed = 0;
    const failures = [];

    for (let i = 0; i < exportFiles.length; i++) {
      const item = exportFiles[i];
      item.status = 'processing';
      item.error = null;
      renderFiles();
      els.processMessage.textContent = `กำลังทำ ${item.name}`;

      try {
        const file = await item.handle.getFile();
        let source = file;

        if (!Number.isFinite(item.duration)) await readMediaDuration(item);
        if (!Number.isFinite(item.duration)) throw new Error('อ่านความยาวคลิปไม่ได้');
        const start = Math.max(0, item.trimStart);
        const end = Math.min(item.duration, item.trimEnd);
        if (end - start < 0.05) throw new Error('ช่วงตัดสั้นเกินไป');
        els.processMessage.textContent = `กำลังตัด ${item.name} แบบ Lossless…`;
        source = await trimLossless(file, start, end);

        const outHandle = await state.outputDirHandle.getFileHandle(outputName(item), { create: true });
        els.processMessage.textContent = `กำลังบันทึก ${outputName(item)}`;
        await writeRotatedSource(source, outHandle, state.rotation, within => setOverallProgress(i, within, exportFiles.length));

        item.status = 'done';
        completed++;
        setOverallProgress(i, 1, exportFiles.length);
      } catch (error) {
        console.error(item.name, error);
        item.status = 'error';
        item.error = error.message || String(error);
        failures.push(`${item.name}: ${item.error}`);
      }

      renderFiles();
      if (state.cancelRequested) break;
    }

    if (state.cancelRequested) {
      els.processMessage.textContent = `หยุดแล้ว · ทำสำเร็จ ${completed} จาก ${exportFiles.length} ไฟล์ที่เลือก`;
    } else if (failures.length) {
      els.processMessage.textContent = `Export สำเร็จ ${completed}/${exportFiles.length} · ไม่สำเร็จ ${failures.length} ไฟล์ · ${failures[0]}`;
    } else {
      els.processMessage.textContent = `เสร็จแล้ว · สำเร็จ ${completed} จาก ${exportFiles.length} ไฟล์ที่เลือก · อยู่ใน Output/`;
    }
    els.openOutputBtn.classList.remove('hidden');
  } catch (error) {
    console.error(error);
    els.processMessage.textContent = `เกิดข้อผิดพลาด: ${error.message || error}`;
  } finally {
    state.processing = false;
    updateSelectionUI();
    els.chooseFolderBtn.disabled = false;
    els.cancelBtn.classList.add('hidden');
    setTrimControlsEnabled(!!currentItem()?.duration);
    updateTrimUI();
    updateSummary();
  }
}

function openOutputFolder() {
  if (!state.outputDirHandle) return;
  alert(`ไฟล์อยู่ที่โฟลเดอร์:\n${state.dirHandle.name}/Output\n\nเปิด Finder แล้วเข้าโฟลเดอร์ต้นฉบับ > Output`);
}

els.rotateLeftBtn.addEventListener('click', () => setRotation(270));
els.rotateResetBtn.addEventListener('click', () => setRotation(0));
els.rotateRightBtn.addEventListener('click', () => setRotation(90));
els.rotate180Btn.addEventListener('click', () => setRotation(180));
els.chooseFolderBtn.addEventListener('click', loadFolder);
els.startBtn.addEventListener('click', processAll);
els.selectAllBtn.addEventListener('click', () => {
  if (state.processing) return;
  state.files.forEach(item => { item.selected = true; });
  updateTrimUI(); renderFiles(); updateSummary(); resetProgress();
});
els.selectNoneBtn.addEventListener('click', () => {
  if (state.processing) return;
  state.files.forEach(item => { item.selected = false; });
  updateTrimUI(); renderFiles(); updateSummary(); resetProgress();
});
els.clipSelected.addEventListener('change', () => {
  const item = currentItem();
  if (!item || state.processing) return;
  item.selected = els.clipSelected.checked;
  renderFiles(); updateSummary(); resetProgress();
});
els.cancelBtn.addEventListener('click', () => {
  state.cancelRequested = true;
  els.cancelBtn.disabled = true;
  els.cancelBtn.textContent = 'กำลังยกเลิก…';
  els.processMessage.textContent = 'จะหยุดหลังจากไฟล์ปัจจุบันเสร็จ';
});
els.openOutputBtn.addEventListener('click', openOutputFolder);
els.prevBtn.addEventListener('click', () => showPreview(state.previewIndex - 1));
els.nextBtn.addEventListener('click', () => showPreview(state.previewIndex + 1));

els.trimEnabled.addEventListener('change', () => {
  els.trimEnabled.checked = true;
  const item = currentItem();
  if (item) item.trimEnabled = true;
});
els.startRange.addEventListener('input', () => setTrimStart(Number(els.startRange.value)));
els.endRange.addEventListener('input', () => setTrimEnd(Number(els.endRange.value)));
els.setStartBtn.addEventListener('click', () => {
  setTrimStart(els.previewVideo.currentTime, false);
  const item = currentItem(); if (item) item.trimEnabled = true;
  updateTrimUI(); renderFiles();
});
els.setEndBtn.addEventListener('click', () => {
  setTrimEnd(els.previewVideo.currentTime, false);
  const item = currentItem(); if (item) item.trimEnabled = true;
  updateTrimUI(); renderFiles();
});
els.jumpStartBtn.addEventListener('click', () => {
  const item = currentItem(); if (item) els.previewVideo.currentTime = item.trimStart;
});
els.jumpEndBtn.addEventListener('click', () => {
  const item = currentItem(); if (item) els.previewVideo.currentTime = Math.max(0, item.trimEnd - 0.01);
});
els.clearTrimBtn.addEventListener('click', () => {
  const item = currentItem(); if (!item?.duration) return;
  item.trimStart = 0; item.trimEnd = item.duration; item.trimEnabled = true;
  state.previewingSelection = false;
  updateTrimUI(); renderFiles();
});
els.previewSelectionBtn.addEventListener('click', async () => {
  const item = currentItem(); if (!item?.duration) return;
  state.previewingSelection = true;
  els.previewVideo.currentTime = item.trimStart;
  try { await els.previewVideo.play(); } catch {}
});

els.previewVideo.addEventListener('timeupdate', () => {
  els.currentTimeText.textContent = formatTime(els.previewVideo.currentTime || 0);
  updateStoryTimeline();
  const item = currentItem();
  if (state.previewingSelection && item && els.previewVideo.currentTime >= item.trimEnd) {
    els.previewVideo.pause();
    els.previewVideo.currentTime = item.trimStart;
    state.previewingSelection = false;
  }
});
els.previewVideo.addEventListener('pause', () => {
  if (!state.previewingSelection) return;
  const item = currentItem();
  if (item && els.previewVideo.currentTime < item.trimEnd - 0.05) state.previewingSelection = false;
});


function bindStoryHandle(handle, side) {
  handle.addEventListener('pointerdown', event => {
    const item = currentItem();
    if (!item?.duration || state.processing) return;
    event.preventDefault();
    event.stopPropagation();
    enableTrimForCurrent();
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('trimming-drag');

    const move = moveEvent => {
      const time = timelineTimeFromClientX(moveEvent.clientX);
      if (side === 'start') setTrimStart(time, true);
      else setTrimEnd(time, true);
    };
    const done = upEvent => {
      try { handle.releasePointerCapture?.(upEvent.pointerId); } catch {}
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', done);
      handle.removeEventListener('pointercancel', done);
      document.body.classList.remove('trimming-drag');
      updateTrimUI();
      renderFiles();
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', done);
    handle.addEventListener('pointercancel', done);
  });

  handle.addEventListener('keydown', event => {
    const item = currentItem();
    if (!item?.duration || state.processing || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    enableTrimForCurrent();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const step = event.shiftKey ? 1 : 0.1;
    if (side === 'start') setTrimStart(item.trimStart + direction * step, true);
    else setTrimEnd(item.trimEnd + direction * step, true);
  });
}

bindStoryHandle(els.trimStartHandle, 'start');
bindStoryHandle(els.trimEndHandle, 'end');

els.trimTimeline.addEventListener('pointerdown', event => {
  if (state.processing || !currentItem()?.duration) return;
  if (event.target.closest('.story-handle')) return;
  const time = timelineTimeFromClientX(event.clientX);
  state.previewingSelection = false;
  els.previewVideo.currentTime = time;
  updateStoryTimeline();
});

window.addEventListener('beforeunload', () => {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.trimWorker?.terminate();
});
