import { inspectVideoRotation, buildRotationPatches, copyWithPatches, Mp4RotationError } from './mp4-rotation.js';

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

function rotationLabel(rotation) {
  if (rotation === 0) return '0°';
  if (rotation === 90) return '90° ขวา';
  if (rotation === 180) return '180°';
  if (rotation === 270) return '90° ซ้าย';
  return 'ไม่ทราบ';
}

function renderFiles() {
  if (!state.files.length) {
    els.fileList.innerHTML = '<div class="empty-list">ยังไม่มีไฟล์</div>';
    return;
  }

  els.fileList.innerHTML = state.files.map((item, i) => `
    <div class="file-row" data-index="${i}">
      <div class="file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      <div class="file-size">${formatBytes(item.size)}</div>
      <div class="file-rotation">${item.inspecting ? 'กำลังอ่าน…' : rotationLabel(item.currentRotation)}</div>
      <div class="file-status ${item.status || 'ready'}">${statusText(item)}</div>
    </div>
  `).join('');
}

function statusText(item) {
  if (item.error) return 'ผิดพลาด';
  if (item.status === 'processing') return 'กำลังทำ…';
  if (item.status === 'done') return '✓ เสร็จแล้ว';
  return 'พร้อม';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
}

function updateSummary() {
  const total = state.files.reduce((sum, f) => sum + f.size, 0);
  els.folderName.textContent = state.dirHandle?.name || '—';
  els.fileCount.textContent = `${state.files.length} ไฟล์`;
  els.totalSize.textContent = formatBytes(total);
  els.startBtn.disabled = !state.files.length || state.processing;
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
    await showPreview(0);
    els.processMessage.textContent = 'พร้อมแล้ว — ไฟล์ต้นฉบับจะไม่ถูกแก้ไข';
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
  els.previewVideo.removeAttribute('src');
  els.previewVideo.load();
  els.previewVideo.style.display = 'none';
  els.emptyPreview.classList.remove('hidden');
  els.previewMeta.textContent = 'เลือกโฟลเดอร์เพื่อดูตัวอย่างไฟล์แรก';
  els.previewIndex.textContent = '0 / 0';
}

async function showPreview(index) {
  if (!state.files.length) return clearPreview();
  state.previewIndex = (index + state.files.length) % state.files.length;
  const item = state.files[state.previewIndex];
  const file = await item.handle.getFile();

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(file);
  els.previewVideo.src = state.previewUrl;
  els.previewVideo.style.display = 'block';
  els.emptyPreview.classList.add('hidden');
  els.previewMeta.textContent = `${item.name} · ${formatBytes(item.size)} · Rotation ปัจจุบัน ${rotationLabel(item.currentRotation)}`;
  els.previewIndex.textContent = `${state.previewIndex + 1} / ${state.files.length}`;
  applyPreviewRotation();
}

function applyPreviewRotation() {
  const r = state.rotation;
  const cssRotation = r === 270 ? -90 : r;
  els.previewVideo.style.transform = `rotate(${cssRotation}deg)`;
  const sideways = r === 90 || r === 270;
  els.previewVideo.classList.toggle('sideways', sideways);

  const label = r === 0 ? 'ยังไม่หมุน' : rotationLabel(r);
  els.previewRotationText.textContent = label;

  const buttonMap = {
    270: els.rotateLeftBtn,
    0: els.rotateResetBtn,
    90: els.rotateRightBtn,
    180: els.rotate180Btn,
  };
  document.querySelectorAll('.rotate-btn').forEach(btn => btn.classList.remove('active'));
  buttonMap[r]?.classList.add('active');
}

function setRotation(rotation) {
  state.rotation = rotation;
  const input = document.querySelector(`input[name="rotation"][value="${rotation}"]`);
  if (input) input.checked = true;
  document.querySelectorAll('.rotation-option').forEach(el => el.classList.remove('selected'));
  input?.closest('.rotation-option')?.classList.add('selected');
  applyPreviewRotation();
}

function resetProgress() {
  els.progressBar.style.width = '0%';
  els.progressText.textContent = '0%';
  els.progressCount.textContent = `0 / ${state.files.length}`;
  els.openOutputBtn.classList.add('hidden');
  els.cancelBtn.classList.add('hidden');
}

function setOverallProgress(fileIndex, withinFile) {
  const total = state.files.length || 1;
  const overall = Math.min(1, (fileIndex + withinFile) / total);
  const pct = Math.round(overall * 100);
  els.progressBar.style.width = `${pct}%`;
  els.progressText.textContent = `${pct}%`;
  els.progressCount.textContent = `${Math.min(fileIndex + (withinFile >= 1 ? 1 : 0), total)} / ${total}`;
}

async function processAll() {
  if (!state.dirHandle || !state.files.length || state.processing) return;
  state.processing = true;
  state.cancelRequested = false;
  els.cancelBtn.disabled = false;
  els.cancelBtn.textContent = 'ยกเลิกหลังจบไฟล์ปัจจุบัน';
  els.startBtn.disabled = true;
  els.chooseFolderBtn.disabled = true;
  els.cancelBtn.classList.remove('hidden');
  els.openOutputBtn.classList.add('hidden');

  try {
    state.outputDirHandle = await state.dirHandle.getDirectoryHandle('Rotated', { create: true });

    let completed = 0;
    for (let i = 0; i < state.files.length; i++) {
      const item = state.files[i];
      item.status = 'processing';
      item.error = null;
      renderFiles();
      els.processMessage.textContent = `กำลังทำ ${item.name}`;

      try {
        const file = await item.handle.getFile();
        const { patches } = await buildRotationPatches(file, state.rotation);
        const outHandle = await state.outputDirHandle.getFileHandle(item.name, { create: true });
        const writable = await outHandle.createWritable();

        try {
          await copyWithPatches(file, writable, patches, within => setOverallProgress(i, within));
          await writable.close();
        } catch (error) {
          try { await writable.abort(); } catch {}
          throw error;
        }

        item.status = 'done';
        item.currentRotation = state.rotation;
        completed++;
        setOverallProgress(i, 1);
      } catch (error) {
        console.error(item.name, error);
        item.status = 'error';
        item.error = error.message || String(error);
      }

      renderFiles();
      if (state.cancelRequested) break;
    }

    if (state.cancelRequested) {
      els.processMessage.textContent = `หยุดแล้ว · ทำสำเร็จ ${completed} จาก ${state.files.length} ไฟล์`;
    } else {
      els.processMessage.textContent = `เสร็จแล้ว · สำเร็จ ${completed} จาก ${state.files.length} ไฟล์ · อยู่ใน Rotated/`;
    }
    els.openOutputBtn.classList.remove('hidden');
  } catch (error) {
    console.error(error);
    els.processMessage.textContent = `เกิดข้อผิดพลาด: ${error.message || error}`;
  } finally {
    state.processing = false;
    els.startBtn.disabled = !state.files.length;
    els.chooseFolderBtn.disabled = false;
    els.cancelBtn.classList.add('hidden');
    updateSummary();
  }
}

async function openOutputFolder() {
  // Browsers intentionally do not expose a direct "open Finder" API for arbitrary directory handles.
  // Re-selecting the output directory keeps the UX explicit and permission-safe.
  if (!state.outputDirHandle) return;
  alert(`ไฟล์อยู่ที่โฟลเดอร์:\n${state.dirHandle.name}/Rotated\n\nเปิด Finder แล้วเข้าโฟลเดอร์ต้นฉบับ > Rotated`);
}

for (const input of document.querySelectorAll('input[name="rotation"]')) {
  input.addEventListener('change', () => setRotation(Number(input.value)));
}

els.rotateLeftBtn.addEventListener('click', () => setRotation(270));
els.rotateResetBtn.addEventListener('click', () => setRotation(0));
els.rotateRightBtn.addEventListener('click', () => setRotation(90));
els.rotate180Btn.addEventListener('click', () => setRotation(180));

els.chooseFolderBtn.addEventListener('click', loadFolder);
els.startBtn.addEventListener('click', processAll);
els.cancelBtn.addEventListener('click', () => {
  state.cancelRequested = true;
  els.cancelBtn.disabled = true;
  els.cancelBtn.textContent = 'กำลังยกเลิก…';
  els.processMessage.textContent = 'จะหยุดหลังจากไฟล์ปัจจุบันเสร็จ';
});
els.openOutputBtn.addEventListener('click', openOutputFolder);
els.prevBtn.addEventListener('click', () => showPreview(state.previewIndex - 1));
els.nextBtn.addEventListener('click', () => showPreview(state.previewIndex + 1));

window.addEventListener('beforeunload', () => {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
});
