import { inspectVideoRotation, buildRotationPatches, copyWithPatches } from './mp4-rotation.js';


// Basic browser UI hardening for public deployment.
// Note: client-side JavaScript cannot completely prevent DevTools from being opened
// from the browser menu or by a determined user. These handlers only block the
// common right-click and keyboard entry points.
function installBrowserUiProtection() {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, true);

  window.addEventListener('keydown', (e) => {
    const key = String(e.key || '').toLowerCase();
    const code = String(e.code || '');
    const ctrlShift = e.ctrlKey && e.shiftKey;
    const macDevtools = e.metaKey && e.altKey;

    const blocked =
      code === 'F12' || key === 'f12' ||
      key === 'contextmenu' || (e.shiftKey && code === 'F10') ||
      (ctrlShift && ['i', 'j', 'c', 'k'].includes(key)) ||
      (macDevtools && ['i', 'j', 'c', 'k', 'u'].includes(key)) ||
      (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'u');

    if (blocked) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);
}
installBrowserUiProtection();

const $ = (s) => document.querySelector(s);
const els = {
  chooseFolderBtn: $('#chooseFolderBtn'), chooseOutputBtn: $('#chooseOutputBtn'), chooseOutputBtn2: $('#chooseOutputBtn2'), grantOutputBtn: $('#grantOutputBtn'), grantOutputBtn2: $('#grantOutputBtn2'), resetOutputBtn: $('#resetOutputBtn'), outputDropZone: $('#outputDropZone'), outputPickerStatus: $('#outputPickerStatus'),
  reviewModeBtn: $('#reviewModeBtn'), browserWarning: $('#browserWarning'), folderName: $('#folderName'), outputFolderName: $('#outputFolderName'),
  fileCount: $('#fileCount'), selectedStat: $('#selectedStat'), presetSelect: $('#presetSelect'), autoBeforeInput: $('#autoBeforeInput'), autoAfterInput: $('#autoAfterInput'),
  autoBeforeLabel: $('#autoBeforeLabel'), autoAfterLabel: $('#autoAfterLabel'), nextAfterTrim: $('#nextAfterTrim'), applyPresetAllBtn: $('#applyPresetAllBtn'),
  previewVideo: $('#previewVideo'), emptyPreview: $('#emptyPreview'), previewMeta: $('#previewMeta'), previewIndex: $('#previewIndex'), prevBtn: $('#prevBtn'), nextBtn: $('#nextBtn'),
  keepBtn: $('#keepBtn'), favoriteBtn: $('#favoriteBtn'), rejectBtn: $('#rejectBtn'), autoTrimBtn: $('#autoTrimBtn'),
  trimEnabled: $('#trimEnabled'), trimTimeline: $('#trimTimeline'), trimFilmstrip: $('#trimFilmstrip'), keyframeLayer: $('#keyframeLayer'), timelineHover: $('#timelineHover'),
  trimStartHandle: $('#trimStartHandle'), trimEndHandle: $('#trimEndHandle'), storyDurationText: $('#storyDurationText'), startRange: $('#startRange'), endRange: $('#endRange'),
  trimStartText: $('#trimStartText'), trimEndText: $('#trimEndText'), currentTimeText: $('#currentTimeText'), selectedDuration: $('#selectedDuration'),
  setStartBtn: $('#setStartBtn'), setEndBtn: $('#setEndBtn'), jumpStartBtn: $('#jumpStartBtn'), jumpEndBtn: $('#jumpEndBtn'), clearTrimBtn: $('#clearTrimBtn'),
  previewSelectionBtn: $('#previewSelectionBtn'), analyzeKeyframesBtn: $('#analyzeKeyframesBtn'), keyframeStatus: $('#keyframeStatus'), snapStartKeyBtn: $('#snapStartKeyBtn'), snapEndKeyBtn: $('#snapEndKeyBtn'),
  previewRotationText: $('#previewRotationText'), rotateLeftBtn: $('#rotateLeftBtn'), rotateResetBtn: $('#rotateResetBtn'), rotateRightBtn: $('#rotateRightBtn'), rotate180Btn: $('#rotate180Btn'), applyRotationAllBtn: $('#applyRotationAllBtn'),
  clipSelected: $('#clipSelected'), clipName: $('#clipName'), clipReviewStatus: $('#clipReviewStatus'), clipDuration: $('#clipDuration'), clipExportRange: $('#clipExportRange'), clipRotationSummary: $('#clipRotationSummary'),
  selectedCount: $('#selectedCount'), selectAllBtn: $('#selectAllBtn'), selectNoneBtn: $('#selectNoneBtn'), filterSelect: $('#filterSelect'), searchInput: $('#searchInput'), filterCount: $('#filterCount'), fileList: $('#fileList'),
  photographerCode: $('#photographerCode'), sequenceStart: $('#sequenceStart'), sequenceDigits: $('#sequenceDigits'), filenamePreview: $('#filenamePreview'), outputDestinationText: $('#outputDestinationText'),
  queueSelected: $('#queueSelected'), queueFavorite: $('#queueFavorite'), queueReject: $('#queueReject'), queueErrors: $('#queueErrors'),
  startBtn: $('#startBtn'), retryFailedBtn: $('#retryFailedBtn'), cancelBtn: $('#cancelBtn'), openOutputBtn: $('#openOutputBtn'), processMessage: $('#processMessage'),
  progressBar: $('#progressBar'), progressText: $('#progressText'), progressCount: $('#progressCount'),
};

const PRESETS = {
  'sq-right': { rotation: 90, before: 2, after: 4 },
  'sq-left': { rotation: 270, before: 2, after: 4 },
  'sq-horizontal': { rotation: 0, before: 2, after: 4 },
};

const state = {
  dirHandle: null,
  outputDirHandle: null,
  pendingOutputDirHandle: null,
  outputExplicit: false,
  files: [],
  previewIndex: 0,
  previewUrl: null,
  processing: false,
  cancelRequested: false,
  previewingSelection: false,
  trimWorker: null,
  trimWorkerRequests: new Map(),
  trimWorkerSeq: 0,
  timelineGeneration: 0,
  filmstripFrames: [],
  reviewMode: false,
  lastFailures: [],
};

const supported = 'showDirectoryPicker' in window && window.isSecureContext;
if (!supported) {
  els.browserWarning.classList.remove('hidden');
  els.chooseFolderBtn.disabled = true;
  els.chooseOutputBtn.disabled = true;
  els.chooseOutputBtn2.disabled = true;
  if (els.grantOutputBtn) els.grantOutputBtn.disabled = true;
  if (els.grantOutputBtn2) els.grantOutputBtn2.disabled = true;
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const ms = Math.floor((seconds % 1) * 1000);
  const whole = Math.floor(seconds), s = whole % 60, m = Math.floor(whole / 60) % 60, h = Math.floor(whole / 3600);
  const base = h > 0 ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${base}.${String(ms).padStart(3,'0')}`;
}
function rotationLabel(r) {
  if (r === 0) return '0°'; if (r === 90) return '90° ขวา'; if (r === 180) return '180°'; if (r === 270) return '90° ซ้าย'; return 'ไม่ทราบ';
}
function reviewLabel(v) { return v === 'favorite' ? '★ Favorite' : v === 'reject' ? '✕ Reject' : '✓ Keep'; }
function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function currentItem() { return state.files[state.previewIndex] || null; }
function selectedFiles() { return state.files.filter(f => f.selected !== false); }
function percentOf(v, total) { return total > 0 ? clamp((v / total) * 100, 0, 100) : 0; }
function safeNumber(input, fallback, min, max) { const n = Number(input.value); return Number.isFinite(n) ? clamp(n, min, max) : fallback; }

function visibleIndexes() {
  const filter = els.filterSelect.value;
  const q = els.searchInput.value.trim().toLowerCase();
  return state.files.map((item, index) => ({item,index})).filter(({item}) => {
    if (q && !item.name.toLowerCase().includes(q)) return false;
    if (filter === 'selected' && item.selected === false) return false;
    if (filter === 'favorite' && item.review !== 'favorite') return false;
    if (filter === 'keep' && item.review !== 'keep') return false;
    if (filter === 'reject' && item.review !== 'reject') return false;
    if (filter === 'error' && item.status !== 'error') return false;
    return true;
  }).map(x => x.index);
}

function navigate(direction, autoplay = false) {
  if (!state.files.length || state.processing) return;
  const visible = visibleIndexes();
  if (!visible.length) return;
  let pos = visible.indexOf(state.previewIndex);
  if (pos < 0) {
    pos = direction > 0 ? visible.findIndex(i => i > state.previewIndex) : [...visible].reverse().findIndex(i => i < state.previewIndex);
    if (pos < 0) pos = direction > 0 ? 0 : visible.length - 1;
    else if (direction < 0) pos = visible.length - 1 - pos;
  } else {
    pos = (pos + direction + visible.length) % visible.length;
  }
  showPreview(visible[pos], { autoplay });
}

async function readMediaDuration(item, timeoutMs = 15000) {
  if (Number.isFinite(item.duration) && item.duration > 0) return item.duration;
  const file = await item.handle.getFile();
  const url = URL.createObjectURL(file);
  const video = document.createElement('video'); video.preload = 'metadata'; video.muted = true; video.playsInline = true;
  try {
    const duration = await new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); video.onloadedmetadata = video.ondurationchange = video.onerror = null; fn(value); };
      const ok = () => { if (Number.isFinite(video.duration) && video.duration > 0) finish(resolve, video.duration); };
      video.onloadedmetadata = ok; video.ondurationchange = ok; video.onerror = () => finish(reject, new Error('อ่านความยาววิดีโอไม่ได้'));
      const timer = setTimeout(() => finish(reject, new Error('อ่านความยาววิดีโอหมดเวลา')), timeoutMs);
      video.src = url; video.load();
    });
    item.duration = duration;
    item.trimStart = clamp(Number.isFinite(item.trimStart) ? item.trimStart : 0, 0, duration);
    if (!Number.isFinite(item.trimEnd) || item.trimEnd <= item.trimStart || item.trimEnd > duration) item.trimEnd = duration;
    return duration;
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

async function inspectAllDurations() {
  let done = 0;
  for (const item of state.files) {
    try { await readMediaDuration(item); }
    catch (e) { item.status = 'metadata-error'; item.error = `อ่านความยาวไม่ได้: ${e.message || e}`; }
    done++; els.processMessage.textContent = `กำลังอ่านความยาว ${done} / ${state.files.length}`; renderFiles();
  }
}

async function inspectAllFiles() {
  let done = 0;
  for (const item of state.files) {
    try {
      const file = await item.handle.getFile();
      const info = await inspectVideoRotation(file);
      const rotations = info.videoTracks.map(t => t.rotation).filter(v => v !== null);
      item.currentRotation = rotations.length ? rotations[0] : null;
    } catch (e) { item.inspectError = e.message || String(e); }
    item.inspecting = false; done++; els.processMessage.textContent = `กำลังอ่าน Rotation ${done} / ${state.files.length}`; renderFiles();
  }
}

function resetFilmstrip(count = 12) {
  const n = clamp(Math.round(count), 8, 18);
  state.filmstripFrames = [];
  els.trimFilmstrip.style.setProperty('--frame-count', n);
  els.trimFilmstrip.innerHTML = Array.from({length:n}, () => '<div class="story-frame placeholder"></div>').join('');
}

function waitMedia(media, event, timeout=6000) {
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => cleanup(() => reject(new Error('หมดเวลารอเฟรม'))), timeout);
    const cleanup = fn => { clearTimeout(timer); media.removeEventListener(event, ok); media.removeEventListener('error', fail); fn(); };
    const ok = () => cleanup(resolve); const fail = () => cleanup(() => reject(new Error('อ่านเฟรมไม่ได้')));
    media.addEventListener(event, ok, {once:true}); media.addEventListener('error', fail, {once:true});
  });
}

async function generateFilmstrip(item, sourceUrl) {
  const generation = ++state.timelineGeneration;
  const count = clamp(Math.round((els.trimTimeline.clientWidth || 760) / 64), 10, 18);
  resetFilmstrip(count);
  if (!item?.duration || !sourceUrl) return;
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = sourceUrl;
  try {
    if (video.readyState < 2) await waitMedia(video, 'loadeddata');
    const canvas = document.createElement('canvas'); canvas.width = 176; canvas.height = 100;
    const ctx = canvas.getContext('2d', {alpha:false}); if (!ctx) return;
    const frames = [];
    for (let i=0; i<count; i++) {
      if (generation !== state.timelineGeneration || currentItem() !== item) return;
      const time = Math.min(Math.max(.03, item.duration * ((i+.5)/count)), Math.max(.03,item.duration-.03));
      video.currentTime = time; await waitMedia(video, 'seeked');
      const vw=video.videoWidth||16,vh=video.videoHeight||9,tr=canvas.width/canvas.height,sr=vw/vh; let sx=0,sy=0,sw=vw,sh=vh;
      if (sr>tr) { sw=vh*tr; sx=(vw-sw)/2; } else { sh=vw/tr; sy=(vh-sh)/2; }
      ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
      frames.push({time, src: canvas.toDataURL('image/jpeg', .65)});
    }
    if (generation !== state.timelineGeneration || currentItem() !== item) return;
    state.filmstripFrames = frames;
    els.trimFilmstrip.style.setProperty('--frame-count', frames.length);
    els.trimFilmstrip.innerHTML = frames.map(f => `<div class="story-frame" style="background-image:url('${f.src}')"></div>`).join('');
  } catch(e) { console.warn('filmstrip',e); resetFilmstrip(count); }
  finally { video.pause(); video.removeAttribute('src'); video.load(); }
}

function updateKeyframeLayer() {
  const item = currentItem(); els.keyframeLayer.innerHTML = '';
  const frames = item?.keyframes;
  if (!item?.duration || !Array.isArray(frames)) return;
  const frag = document.createDocumentFragment();
  for (const t of frames) {
    if (t < 0 || t > item.duration) continue;
    const mark = document.createElement('i'); mark.className='keyframe-mark'; mark.style.left=`${percentOf(t,item.duration)}%`; mark.title=`Keyframe ${formatTime(t)}`; frag.appendChild(mark);
  }
  els.keyframeLayer.appendChild(frag);
}

function updateStoryTimeline() {
  const item = currentItem();
  if (!item?.duration) {
    els.trimTimeline.style.setProperty('--start-pct','0%'); els.trimTimeline.style.setProperty('--end-pct','100%'); els.trimTimeline.style.setProperty('--play-pct','0%');
    els.storyDurationText.textContent='00:00.000'; return;
  }
  const start=clamp(item.trimStart||0,0,item.duration), end=clamp(item.trimEnd??item.duration,start,item.duration), play=clamp(els.previewVideo.currentTime||0,0,item.duration);
  els.trimTimeline.style.setProperty('--start-pct',`${percentOf(start,item.duration)}%`); els.trimTimeline.style.setProperty('--end-pct',`${percentOf(end,item.duration)}%`); els.trimTimeline.style.setProperty('--play-pct',`${percentOf(play,item.duration)}%`);
  els.storyDurationText.textContent=formatTime(end-start);
}
function timelineTimeFromClientX(x) { const item=currentItem(); if(!item?.duration)return 0; const r=els.trimTimeline.getBoundingClientRect(); return clamp((x-r.left)/r.width,0,1)*item.duration; }

function setTrimControlsEnabled(enabled) {
  const disabled=!enabled||state.processing;
  [els.startRange,els.endRange,els.setStartBtn,els.setEndBtn,els.jumpStartBtn,els.jumpEndBtn,els.clearTrimBtn,els.previewSelectionBtn,els.trimStartHandle,els.trimEndHandle,els.autoTrimBtn,els.analyzeKeyframesBtn].forEach(el=>{if(el)el.disabled=disabled;});
  const item=currentItem();
  els.snapStartKeyBtn.disabled=disabled||!item?.keyframes?.length; els.snapEndKeyBtn.disabled=disabled||!item?.keyframes?.length;
  els.trimTimeline.classList.toggle('disabled',disabled);
  els.keepBtn.disabled=els.favoriteBtn.disabled=els.rejectBtn.disabled=!item||state.processing;
}

function updateTrimUI() {
  const item=currentItem();
  if(!item?.duration){
    els.trimStartText.textContent=els.trimEndText.textContent=els.currentTimeText.textContent='00:00.000'; els.selectedDuration.textContent='ยังไม่ได้เลือกคลิป';
    els.clipDuration.textContent='—'; els.clipExportRange.textContent='—'; els.clipReviewStatus.textContent='—'; els.clipRotationSummary.textContent='—';
    els.clipSelected.checked=false; els.clipSelected.disabled=true; els.keyframeStatus.textContent='ยังไม่วิเคราะห์'; updateStoryTimeline(); updateKeyframeLayer(); return;
  }
  const end=clamp(item.trimEnd??item.duration,.05,item.duration), start=clamp(item.trimStart||0,0,Math.max(0,end-.05)); item.trimStart=start; item.trimEnd=end;
  els.startRange.max=item.duration; els.endRange.max=item.duration; els.startRange.value=start; els.endRange.value=end;
  els.trimStartText.textContent=formatTime(start); els.trimEndText.textContent=formatTime(end); els.currentTimeText.textContent=formatTime(els.previewVideo.currentTime||0);
  els.selectedDuration.textContent=`ช่วง ${formatTime(end-start)}`; els.clipDuration.textContent=formatTime(item.duration); els.clipExportRange.textContent=`${formatTime(start)} → ${formatTime(end)}`;
  els.clipReviewStatus.textContent=reviewLabel(item.review); els.clipRotationSummary.textContent=rotationLabel(item.rotation); els.clipSelected.checked=item.selected!==false; els.clipSelected.disabled=state.processing;
  if(item.keyframesLoading) els.keyframeStatus.textContent='กำลังวิเคราะห์…'; else if(Array.isArray(item.keyframes)) els.keyframeStatus.textContent=`${item.keyframes.length} Keyframes`; else els.keyframeStatus.textContent='ยังไม่วิเคราะห์';
  els.snapStartKeyBtn.disabled=state.processing||!item.keyframes?.length; els.snapEndKeyBtn.disabled=state.processing||!item.keyframes?.length;
  updateStoryTimeline(); updateKeyframeLayer(); updateReviewButtons();
}

function setTrimStart(v, seek=false) { const item=currentItem(); if(!item?.duration)return; item.trimStart=clamp(v,0,Math.max(0,item.trimEnd-.05)); if(seek)els.previewVideo.currentTime=item.trimStart; updateTrimUI(); renderFiles(); }
function setTrimEnd(v, seek=false) { const item=currentItem(); if(!item?.duration)return; item.trimEnd=clamp(v,Math.min(item.duration,item.trimStart+.05),item.duration); if(seek)els.previewVideo.currentTime=Math.max(0,item.trimEnd-.001); updateTrimUI(); renderFiles(); }

function updateReviewButtons(){
  const item=currentItem(); [els.keepBtn,els.favoriteBtn,els.rejectBtn].forEach(b=>b.classList.remove('active')); if(!item)return;
  if(item.review==='favorite')els.favoriteBtn.classList.add('active'); else if(item.review==='reject')els.rejectBtn.classList.add('active'); else els.keepBtn.classList.add('active');
}
function setReviewStatus(status, autoNavigate=false){
  const item=currentItem(); if(!item||state.processing)return; item.review=status; if(status==='reject')item.selected=false; else item.selected=true; item.status=item.status==='error'?item.status:'ready';
  updateTrimUI(); renderFiles(); updateSummary(); if(autoNavigate)navigate(1, true);
}

function applyPreviewRotation(){
  const item=currentItem(); const r=item?.rotation??0, css=r===270?-90:r;
  els.previewVideo.style.transform=`rotate(${css}deg)`; els.previewVideo.classList.toggle('sideways',r===90||r===270); els.previewRotationText.textContent=r===0?'ยังไม่หมุน':rotationLabel(r);
  const map={270:els.rotateLeftBtn,0:els.rotateResetBtn,90:els.rotateRightBtn,180:els.rotate180Btn}; document.querySelectorAll('.rotate-btn').forEach(b=>b.classList.remove('active')); map[r]?.classList.add('active');
  els.clipRotationSummary.textContent=item?rotationLabel(r):'—';
}
function setRotation(r){ const item=currentItem(); if(!item||state.processing)return; item.rotation=r; applyPreviewRotation(); renderFiles(); }

function autoTrimCurrent(){
  const item=currentItem(); if(!item?.duration||state.processing)return;
  const before=safeNumber(els.autoBeforeInput,2,0,60), after=safeNumber(els.autoAfterInput,4,.1,60), anchor=clamp(els.previewVideo.currentTime||0,0,item.duration);
  item.trimStart=clamp(anchor-before,0,item.duration); item.trimEnd=clamp(anchor+after,item.trimStart+.05,item.duration); updateTrimUI(); renderFiles();
  if(els.nextAfterTrim.checked) navigate(1, true);
}

function nearestKeyframe(time, mode){
  const frames=currentItem()?.keyframes||[]; if(!frames.length)return null;
  if(mode==='before'){ const a=frames.filter(t=>t<=time+.0005); return a.length?a[a.length-1]:frames[0]; }
  const a=frames.filter(t=>t>=time-.0005); return a.length?a[0]:frames[frames.length-1];
}

function updatePresetLabels(){
  const before=safeNumber(els.autoBeforeInput,2,0,60), after=safeNumber(els.autoAfterInput,4,.1,60); els.autoBeforeLabel.textContent=`${before.toFixed(1)}s`; els.autoAfterLabel.textContent=`${after.toFixed(1)}s`;
}
function applyPresetSelection(){
  const p=PRESETS[els.presetSelect.value]; if(!p){updatePresetLabels();return;} els.autoBeforeInput.value=p.before; els.autoAfterInput.value=p.after; updatePresetLabels(); if(currentItem())setRotation(p.rotation);
}

function updateSelectionUI(){
  const selected=selectedFiles().length,total=state.files.length,fav=state.files.filter(f=>f.review==='favorite').length,reject=state.files.filter(f=>f.review==='reject').length,errors=state.files.filter(f=>f.status==='error').length;
  els.selectedCount.textContent=`${selected} / ${total} ไฟล์`; els.selectedStat.textContent=`${selected} ไฟล์`; els.queueSelected.textContent=selected; els.queueFavorite.textContent=fav; els.queueReject.textContent=reject; els.queueErrors.textContent=errors;
  els.selectAllBtn.disabled=!total||state.processing||selected===total; els.selectNoneBtn.disabled=!total||state.processing||selected===0; els.startBtn.disabled=selected===0||state.processing; els.startBtn.textContent=selected?`Export ที่เลือก (${selected})`:'เลือกไฟล์ก่อน Export';
  els.retryFailedBtn.classList.toggle('hidden', state.lastFailures.length===0 || state.processing); els.retryFailedBtn.textContent=`↻ Retry ที่ผิดพลาด (${state.lastFailures.length})`;
}
function trimText(item){ return item.duration?`${formatTime(item.trimStart)}–${formatTime(item.trimEnd)}`:'กำลังอ่าน…'; }
function statusText(item){ if(item.status==='processing')return'กำลังทำ…'; if(item.status==='done')return'✓ เสร็จ'; if(item.status==='error')return'ผิดพลาด'; if(item.selected===false)return'ไม่ Export'; return'พร้อม'; }

function renderFiles(){
  const indexes=visibleIndexes(); els.filterCount.textContent=`${indexes.length} รายการ`;
  if(!state.files.length){els.fileList.innerHTML='<div class="empty-list">ยังไม่มีไฟล์</div>';updateSelectionUI();return;}
  if(!indexes.length){els.fileList.innerHTML='<div class="empty-list">ไม่พบไฟล์ตาม Filter</div>';updateSelectionUI();return;}
  els.fileList.innerHTML=indexes.map(i=>{const item=state.files[i];return `
    <div class="file-row pro-file-row ${i===state.previewIndex?'active':''} ${item.selected===false?'excluded':''} ${item.review==='favorite'?'favorite-row':''} ${item.review==='reject'?'reject-row':''} ${item.status==='error'?'error-row':''}">
      <label class="file-select" title="เลือกสำหรับ Export"><input class="file-select-input" type="checkbox" data-select-index="${i}" ${item.selected===false?'':'checked'} ${state.processing?'disabled':''}/><span class="file-checkmark">✓</span></label>
      <button class="file-open pro-file-open" data-index="${i}" type="button">
        <div class="file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div><div class="file-size">${formatBytes(item.size)}</div><div class="file-trim">${trimText(item)}</div>
        <div class="file-rotation">${rotationLabel(item.rotation)}</div><div class="file-review-badge ${item.review}">${reviewLabel(item.review)}</div><div class="file-status ${item.status||'ready'}" title="${escapeHtml(item.error||'')}">${statusText(item)}</div>
      </button>
    </div>`}).join('');
  els.fileList.querySelectorAll('.file-open').forEach(b=>b.addEventListener('click',()=>showPreview(Number(b.dataset.index))));
  els.fileList.querySelectorAll('.file-select-input').forEach(input=>input.addEventListener('change',()=>{const item=state.files[Number(input.dataset.selectIndex)];if(!item||state.processing)return;item.selected=input.checked;renderFiles();updateSummary();resetProgress();}));
  updateSelectionUI();
}

function updateOutputPickerUI(message=''){
  const pending = state.pendingOutputDirHandle && !state.outputExplicit;
  const ready = state.outputExplicit && state.outputDirHandle;
  if (els.grantOutputBtn) els.grantOutputBtn.classList.toggle('hidden', !pending);
  if (els.grantOutputBtn2) els.grantOutputBtn2.classList.toggle('hidden', !pending);
  if (els.outputDropZone) {
    els.outputDropZone.classList.toggle('output-ready', !!ready);
    els.outputDropZone.classList.toggle('output-pending', !!pending);
  }
  if (els.outputPickerStatus) {
    els.outputPickerStatus.textContent = message || (ready ? `พร้อมเขียน: ${state.outputDirHandle.name}` : pending ? `เลือก ${state.pendingOutputDirHandle.name} แล้ว — กด “อนุญาตเขียน”` : 'ยังไม่ได้เลือกโฟลเดอร์ปลายทางแบบกำหนดเอง');
  }
}

function updateSummary(){
  els.folderName.textContent=state.dirHandle?.name||'—'; els.outputFolderName.textContent=state.outputExplicit?(state.outputDirHandle?.name||'—'):(state.dirHandle?'ต้นฉบับ/Output':'ต้นฉบับ/Output');
  els.outputDestinationText.textContent=state.outputExplicit?`โฟลเดอร์ที่เลือก: ${state.outputDirHandle?.name||'—'}`:'โฟลเดอร์ต้นฉบับ / Output'; els.fileCount.textContent=`${state.files.length} ไฟล์`;
  const visible=visibleIndexes(); els.prevBtn.disabled=visible.length<=1||state.processing; els.nextBtn.disabled=visible.length<=1||state.processing; els.applyPresetAllBtn.disabled=!state.files.length||state.processing; els.applyRotationAllBtn.disabled=!state.files.length||state.processing;
  els.resetOutputBtn.classList.toggle('hidden',!state.outputExplicit); updateOutputPickerUI(); updateSelectionUI();
}

async function queryWritePermission(handle){
  if (!handle) return 'denied';
  if (!handle.queryPermission) return 'prompt';
  try { return await handle.queryPermission({mode:'readwrite'}); } catch { return 'prompt'; }
}

async function requestWritePermission(handle){
  if (!handle) return false;
  const current = await queryWritePermission(handle);
  if (current === 'granted') return true;
  if (!handle.requestPermission) return false;
  try { return (await handle.requestPermission({mode:'readwrite'})) === 'granted'; } catch (e) {
    console.warn('requestPermission failed', e);
    return false;
  }
}

async function verifyOutputWritable(handle){
  const testName = `.sony-video-review-pro-write-test-${Date.now()}.tmp`;
  let created = false;
  try {
    const fh = await handle.getFileHandle(testName,{create:true});
    created = true;
    const w = await fh.createWritable();
    await w.write(new Uint8Array([83,86,82,80]));
    await w.close();
    await handle.removeEntry(testName);
    return true;
  } catch (e) {
    if (created) { try { await handle.removeEntry(testName); } catch {} }
    console.warn('Output write test failed', e);
    throw e;
  }
}

async function activateOutputHandle(handle, {requestPermissionNow=true} = {}){
  if (!handle || handle.kind !== 'directory') throw new Error('รายการที่เลือกไม่ใช่โฟลเดอร์');
  state.pendingOutputDirHandle = handle;
  state.outputExplicit = false;
  state.outputDirHandle = null;
  updateOutputPickerUI(`เลือก ${handle.name} แล้ว · กำลังตรวจสิทธิ์เขียน…`);

  let granted = (await queryWritePermission(handle)) === 'granted';
  if (!granted && requestPermissionNow) granted = await requestWritePermission(handle);
  if (!granted) {
    updateSummary();
    updateOutputPickerUI(`เลือก ${handle.name} แล้ว แต่ยังไม่มีสิทธิ์เขียน · กด “อนุญาตเขียน”`);
    els.processMessage.textContent=`เลือกปลายทาง ${handle.name} แล้ว — ต้องอนุญาตการเขียนอีกครั้ง`;
    return false;
  }

  await verifyOutputWritable(handle);
  state.outputDirHandle = handle;
  state.pendingOutputDirHandle = null;
  state.outputExplicit = true;
  updateSummary();
  updateOutputPickerUI(`พร้อม Export ไปที่: ${handle.name}`);
  els.processMessage.textContent=`ปลายทาง Export พร้อมใช้งาน: ${handle.name}`;
  return true;
}

async function chooseOutputFolder(){
  if (!supported) return;
  try {
    // Chrome ไม่อนุญาตให้เว็บถือสิทธิ์ทั้ง Home/Desktop/Downloads หรือ root ของไดรฟ์
    // จึงเริ่มจากโฟลเดอร์วิดีโอ และให้ผู้ใช้เลือก/สร้างโฟลเดอร์ย่อยของตัวเอง
    updateOutputPickerUI('ในหน้าต่างถัดไป ให้เลือก “โฟลเดอร์ย่อยที่สร้างเอง” เช่น SonyExport — ห้ามเลือก Desktop/Downloads/ชื่อ SSD ทั้งก้อน');
    els.processMessage.textContent='เลือกปลายทาง: สร้างโฟลเดอร์ย่อย เช่น SonyExport แล้วเลือกโฟลเดอร์นั้น';
    const opts={id:'sony-video-review-output', mode:'readwrite', startIn:'videos'};
    const h=await window.showDirectoryPicker(opts);
    await activateOutputHandle(h,{requestPermissionNow:true});
  } catch(e) {
    if(e?.name==='AbortError') {
      const msg='Chrome ไม่อนุญาตโฟลเดอร์ระดับระบบ/ระดับไดรฟ์ ให้กดเลือกใหม่ แล้วสร้างโฟลเดอร์ย่อย เช่น SonyExport ก่อนเลือก';
      updateOutputPickerUI(msg);
      els.processMessage.textContent=msg;
      return;
    }
    if(e?.name==='SecurityError') {
      const msg='Chrome บล็อกการเปิดโฟลเดอร์ กรุณากดปุ่ม “เลือก/สร้างโฟลเดอร์ Export” โดยตรง และเลือกโฟลเดอร์ย่อยที่สร้างเอง';
      updateOutputPickerUI(msg);
      els.processMessage.textContent=msg;
      return;
    }
    console.error('chooseOutputFolder',e);
    updateOutputPickerUI(`เลือกปลายทางไม่สำเร็จ: ${e.message||e}`);
    els.processMessage.textContent=`เลือกปลายทางไม่สำเร็จ: ${e.message||e}`;
  }
}

async function grantPendingOutputPermission(){
  const h=state.pendingOutputDirHandle;
  if(!h)return;
  try {
    const ok=await requestWritePermission(h);
    if(!ok){updateOutputPickerUI(`ยังไม่ได้รับสิทธิ์เขียน ${h.name}`);return;}
    await activateOutputHandle(h,{requestPermissionNow:false});
  } catch(e){console.error(e);updateOutputPickerUI(`อนุญาตเขียนไม่สำเร็จ: ${e.message||e}`);els.processMessage.textContent=`อนุญาตเขียนไม่สำเร็จ: ${e.message||e}`;}
}

async function handleOutputDrop(event){
  event.preventDefault();
  els.outputDropZone?.classList.remove('dragover');
  try {
    const items=[...(event.dataTransfer?.items||[])];
    const item=items.find(i=>i.kind==='file');
    if(!item)throw new Error('ไม่พบโฟลเดอร์ที่ลากมา');
    let h=null;
    if(item.getAsFileSystemHandle) h=await item.getAsFileSystemHandle();
    if(!h || h.kind!=='directory')throw new Error('กรุณาลาก “โฟลเดอร์” จาก Finder มาวาง');
    await activateOutputHandle(h,{requestPermissionNow:true});
  } catch(e){console.error(e);updateOutputPickerUI(`รับโฟลเดอร์จาก Finder ไม่สำเร็จ: ${e.message||e}`);}
}

function resetOutputFolder(){state.outputDirHandle=null;state.pendingOutputDirHandle=null;state.outputExplicit=false;updateSummary();updateOutputPickerUI();els.processMessage.textContent='ปลายทางกลับเป็นโฟลเดอร์ Output ภายในต้นฉบับ';}

async function loadFolder(){
  try{
    const dir=await window.showDirectoryPicker({mode:'readwrite',id:'sony-video-rotator-source'}); state.dirHandle=dir; state.files=[]; state.previewIndex=0; state.lastFailures=[];
    for await(const [name,handle] of dir.entries()){
      if(handle.kind!=='file'||!/\.(mp4|mov)$/i.test(name))continue; const file=await handle.getFile();
      state.files.push({name,handle,size:file.size,lastModified:file.lastModified,currentRotation:null,rotation:(PRESETS[els.presetSelect.value]?.rotation ?? 0),review:'keep',selected:true,status:'ready',error:null,duration:null,trimStart:0,trimEnd:null,keyframes:null,keyframesLoading:false,plannedOutputName:null,inspecting:true});
    }
    state.files.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})); updateSummary();renderFiles();resetProgress();
    if(!state.files.length){clearPreview();els.processMessage.textContent='ไม่พบ .MP4 หรือ .MOV';return;}
    els.processMessage.textContent='กำลังตรวจข้อมูลคลิป…'; await inspectAllFiles(); await inspectAllDurations(); await showPreview(0); els.processMessage.textContent='พร้อม — ไล่ Review แล้ว Export ได้เลย';
  }catch(e){if(e?.name==='AbortError')return;console.error(e);alert(`เลือกโฟลเดอร์ไม่สำเร็จ: ${e.message||e}`);}
}

function clearPreview(){
  if(state.previewUrl)URL.revokeObjectURL(state.previewUrl); state.previewUrl=null; state.timelineGeneration++;resetFilmstrip();els.previewVideo.removeAttribute('src');els.previewVideo.load();els.previewVideo.style.display='none';els.emptyPreview.classList.remove('hidden');els.previewMeta.textContent='เลือกโฟลเดอร์เพื่อเริ่ม';els.previewIndex.textContent='0 / 0';setTrimControlsEnabled(false);updateTrimUI();
}
async function showPreview(index, { autoplay = false } = {}){
  if(!state.files.length)return clearPreview(); state.previewingSelection=false;state.previewIndex=clamp(index,0,state.files.length-1);const item=currentItem();const file=await item.handle.getFile();
  els.previewVideo.pause();state.timelineGeneration++;resetFilmstrip();if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl=URL.createObjectURL(file);els.previewVideo.src=state.previewUrl;els.previewVideo.style.display='block';els.emptyPreview.classList.add('hidden');
  els.previewMeta.textContent=`${item.name} · ${formatBytes(item.size)} · metadata ${rotationLabel(item.currentRotation)}`; const vis=visibleIndexes();const pos=vis.indexOf(state.previewIndex);els.previewIndex.textContent=pos>=0?`${pos+1} / ${vis.length}`:`${state.previewIndex+1} / ${state.files.length}`;els.clipName.textContent=item.name; updateFilenamePreview();
  applyPreviewRotation();renderFiles();
  await new Promise(resolve=>{if(els.previewVideo.readyState>=1&&Number.isFinite(els.previewVideo.duration))return resolve();const done=()=>resolve();els.previewVideo.addEventListener('loadedmetadata',done,{once:true});els.previewVideo.addEventListener('error',done,{once:true});});
  if(Number.isFinite(els.previewVideo.duration)&&els.previewVideo.duration>0){item.duration=els.previewVideo.duration;if(!Number.isFinite(item.trimEnd)||item.trimEnd>item.duration)item.trimEnd=item.duration;setTrimControlsEnabled(true);updateTrimUI();generateFilmstrip(item,state.previewUrl);if(autoplay){els.previewVideo.muted=true;try{await els.previewVideo.play();}catch{}}}else{setTrimControlsEnabled(false);els.selectedDuration.textContent='อ่านความยาวไม่ได้';}
  updateSummary();
}

function getTrimWorker(){
  if(state.trimWorker)return state.trimWorker; const worker=new Worker('./trim-worker.js');
  worker.addEventListener('message',event=>{const msg=event.data||{};if(msg.type==='engine'){if(msg.status==='loading')els.processMessage.textContent='กำลังโหลด FFmpeg WebAssembly…';return;}if(msg.type==='log'){if(msg.message)console.debug('[FFmpeg]',msg.message);return;}if(msg.type!=='result')return;const req=state.trimWorkerRequests.get(msg.id);if(!req)return;state.trimWorkerRequests.delete(msg.id);if(msg.ok){if(msg.buffer)req.resolve({buffer:msg.buffer,extension:msg.extension||'.mp4'});else if(Array.isArray(msg.keyframes))req.resolve({keyframes:msg.keyframes});else req.resolve(true);}else req.reject(new Error(msg.error||'FFmpeg ล้มเหลว'));});
  worker.addEventListener('error',event=>{for(const req of state.trimWorkerRequests.values())req.reject(new Error(event.message||'Worker error'));state.trimWorkerRequests.clear();}); state.trimWorker=worker;return worker;
}
function workerRequest(type,payload={}){const worker=getTrimWorker(),id=++state.trimWorkerSeq;return new Promise((resolve,reject)=>{state.trimWorkerRequests.set(id,{resolve,reject});worker.postMessage({id,type,...payload});});}
async function trimLossless(file,start,end){const result=await workerRequest('trim',{file,start,end});const ext=result.extension||'.mp4';return{blob:new Blob([result.buffer],{type:ext==='.mov'?'video/quicktime':'video/mp4'}),extension:ext};}
async function analyzeCurrentKeyframes(){
  const item=currentItem();if(!item||state.processing||item.keyframesLoading)return;if(Array.isArray(item.keyframes)){updateTrimUI();return;}item.keyframesLoading=true;updateTrimUI();
  try{const file=await item.handle.getFile();const result=await workerRequest('keyframes',{file});item.keyframes=result.keyframes||[];els.processMessage.textContent=`${item.name}: พบ ${item.keyframes.length} Keyframes`;}
  catch(e){item.keyframes=[];item.keyframeError=e.message||String(e);els.processMessage.textContent=`วิเคราะห์ Keyframe ไม่สำเร็จ: ${item.keyframeError}`;}
  finally{item.keyframesLoading=false;updateTrimUI();renderFiles();}
}

async function writeRotatedSource(sourceBlob,outHandle,rotation,onProgress){const{patches}=await buildRotationPatches(sourceBlob,rotation);const writable=await outHandle.createWritable();try{await copyWithPatches(sourceBlob,writable,patches,onProgress);await writable.close();}catch(e){try{await writable.abort();}catch{}throw e;}}
function resetProgress(){els.progressBar.style.width='0%';els.progressText.textContent='0%';els.progressCount.textContent=`0 / ${selectedFiles().length}`;els.cancelBtn.classList.add('hidden');els.openOutputBtn.classList.add('hidden');}
function setOverallProgress(i,within,total){const overall=Math.min(1,(i+within)/(total||1)),pct=Math.round(overall*100);els.progressBar.style.width=`${pct}%`;els.progressText.textContent=`${pct}%`;els.progressCount.textContent=`${Math.min(i+(within>=1?1:0),total)} / ${total}`;}
function sanitizedPhotographerCode(){
  const digits=String(els.photographerCode?.value||'').replace(/\D+/g,'').slice(0,8);
  if(els.photographerCode && els.photographerCode.value!==digits) els.photographerCode.value=digits;
  return digits||'17';
}
function buildOutputName(item,sequenceNumber){
  const code=sanitizedPhotographerCode();
  const digits=Number(els.sequenceDigits.value)||3;
  const ext=/\.mov$/i.test(item.name)?'.mov':'.mp4';
  const base=item.name.replace(/\.[^.]+$/,'');
  return `${base}_PSE${code}_${String(sequenceNumber).padStart(digits,'0')}${ext}`;
}
function updateFilenamePreview(){
  if(!els.filenamePreview)return;
  const sample=currentItem()||state.files[0]||{name:'C0001.MP4'};
  const start=Math.max(0,Math.floor(Number(els.sequenceStart.value)||1));
  els.filenamePreview.textContent=buildOutputName(sample,start);
}
function planOutputNames(queue,retry=false){
  const start=Math.max(0,Math.floor(Number(els.sequenceStart.value)||1));
  queue.forEach((item,i)=>{if(retry&&item.plannedOutputName)return;item.plannedOutputName=buildOutputName(item,start+i);});
}
async function resolveOutputHandle(){
  if(state.outputExplicit&&state.outputDirHandle){
    const perm=await queryWritePermission(state.outputDirHandle);
    if(perm!=='granted')throw new Error(`สิทธิ์เขียนโฟลเดอร์ ${state.outputDirHandle.name} หมดอายุ กรุณากด “เลือกโฟลเดอร์ Export” ใหม่`);
    return state.outputDirHandle;
  }
  if(state.pendingOutputDirHandle)throw new Error(`เลือกโฟลเดอร์ ${state.pendingOutputDirHandle.name} แล้ว แต่ยังไม่ได้อนุญาตเขียน กรุณากด “อนุญาตเขียนโฟลเดอร์”`);
  if(!state.dirHandle)throw new Error('ยังไม่ได้เลือกโฟลเดอร์ต้นฉบับ');
  const sourcePerm=await queryWritePermission(state.dirHandle);
  if(sourcePerm!=='granted')throw new Error('ไม่มีสิทธิ์เขียนในโฟลเดอร์ต้นฉบับ กรุณาเลือกโฟลเดอร์ต้นฉบับใหม่');
  state.outputDirHandle=await state.dirHandle.getDirectoryHandle('Output',{create:true});
  return state.outputDirHandle;
}

async function processQueue(queue,{retry=false}={}){
  if(!queue.length||state.processing)return;state.processing=true;state.cancelRequested=false;state.previewingSelection=false;state.lastFailures=[];els.previewVideo.pause();els.cancelBtn.disabled=false;els.cancelBtn.textContent='ยกเลิกหลังจบไฟล์ปัจจุบัน';els.cancelBtn.classList.remove('hidden');els.startBtn.disabled=true;els.chooseFolderBtn.disabled=true;setTrimControlsEnabled(false);planOutputNames(queue,retry);
  try{
    const outDir=await resolveOutputHandle();let completed=0;const failures=[];
    for(let i=0;i<queue.length;i++){
      const item=queue[i];item.status='processing';item.error=null;renderFiles();els.processMessage.textContent=`กำลังตัด ${item.name}…`;
      try{
        const file=await item.handle.getFile();if(!item.duration)await readMediaDuration(item);const start=clamp(item.trimStart,0,item.duration),end=clamp(item.trimEnd,start+.05,item.duration);if(end-start<.05)throw new Error('ช่วงตัดสั้นเกินไป');
        const trimmed=await trimLossless(file,start,end);let finalName=item.plannedOutputName;if(trimmed.extension&& !finalName.toLowerCase().endsWith(trimmed.extension)) finalName=finalName.replace(/\.[^.]+$/,trimmed.extension);item.plannedOutputName=finalName;
        const outHandle=await outDir.getFileHandle(finalName,{create:true});els.processMessage.textContent=`กำลังบันทึก ${finalName} · ${rotationLabel(item.rotation)} · Video-only Lossless`;
        await writeRotatedSource(trimmed.blob,outHandle,item.rotation,within=>setOverallProgress(i,within,queue.length));item.status='done';completed++;setOverallProgress(i,1,queue.length);
      }catch(e){console.error(item.name,e);item.status='error';item.error=e.message||String(e);failures.push(item);}
      renderFiles();if(state.cancelRequested)break;
    }
    state.lastFailures=failures;
    if(state.cancelRequested)els.processMessage.textContent=`หยุดแล้ว · สำเร็จ ${completed}/${queue.length}`;
    else if(failures.length)els.processMessage.textContent=`Export สำเร็จ ${completed}/${queue.length} · ผิดพลาด ${failures.length} ไฟล์ — กด Retry ได้`;
    else els.processMessage.textContent=`เสร็จแล้ว · Export ${completed} ไฟล์ ไปที่ ${state.outputExplicit?state.outputDirHandle.name:`${state.dirHandle.name}/Output`}`;
    els.openOutputBtn.classList.remove('hidden');
  }catch(e){console.error(e);els.processMessage.textContent=`เกิดข้อผิดพลาด: ${e.message||e}`;}
  finally{state.processing=false;els.chooseFolderBtn.disabled=false;els.cancelBtn.classList.add('hidden');setTrimControlsEnabled(!!currentItem()?.duration);updateTrimUI();renderFiles();updateSummary();}
}
function processAll(){processQueue(selectedFiles(),{retry:false});}
function retryFailed(){const q=state.lastFailures.filter(item=>item.status==='error');processQueue(q,{retry:true});}
function showOutputLocation(){alert(state.outputExplicit?`ไฟล์ถูก Export ไปที่โฟลเดอร์ที่เลือก:\n${state.outputDirHandle?.name||'—'}`:`ไฟล์อยู่ที่:\n${state.dirHandle?.name||'ต้นฉบับ'}/Output`);}

function toggleReviewMode(){state.reviewMode=!state.reviewMode;document.body.classList.toggle('review-mode',state.reviewMode);els.reviewModeBtn.textContent=state.reviewMode?'↩ ออกจาก Review Mode':'🎬 Review Mode';setTimeout(()=>{if(currentItem()&&state.previewUrl)generateFilmstrip(currentItem(),state.previewUrl);},100);}

function bindStoryHandle(handle,side){
  handle.addEventListener('pointerdown',e=>{const item=currentItem();if(!item?.duration||state.processing)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture?.(e.pointerId);document.body.classList.add('trimming-drag');
    const move=ev=>{const t=timelineTimeFromClientX(ev.clientX);side==='start'?setTrimStart(t,true):setTrimEnd(t,true);}; const done=ev=>{try{handle.releasePointerCapture?.(ev.pointerId);}catch{}handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',done);handle.removeEventListener('pointercancel',done);document.body.classList.remove('trimming-drag');};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',done);handle.addEventListener('pointercancel',done);
  });
  handle.addEventListener('keydown',e=>{const item=currentItem();if(!item?.duration||state.processing||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const d=e.key==='ArrowRight'?1:-1,step=e.shiftKey?1:.1;side==='start'?setTrimStart(item.trimStart+d*step,true):setTrimEnd(item.trimEnd+d*step,true);});
}

function updateTimelineHover(clientX){
  const item=currentItem();if(!item?.duration||!state.filmstripFrames.length)return;const rect=els.trimTimeline.getBoundingClientRect(),ratio=clamp((clientX-rect.left)/rect.width,0,1),time=ratio*item.duration;
  let nearest=state.filmstripFrames[0];for(const f of state.filmstripFrames)if(Math.abs(f.time-time)<Math.abs(nearest.time-time))nearest=f;
  els.timelineHover.style.left=`${ratio*100}%`;els.timelineHover.querySelector('.timeline-hover-thumb').style.backgroundImage=`url('${nearest.src}')`;els.timelineHover.querySelector('strong').textContent=formatTime(time);els.timelineHover.classList.remove('hidden');
}

// Source/output
els.chooseFolderBtn.addEventListener('click',loadFolder);els.chooseOutputBtn.addEventListener('click',chooseOutputFolder);els.chooseOutputBtn2.addEventListener('click',chooseOutputFolder);els.grantOutputBtn?.addEventListener('click',grantPendingOutputPermission);els.grantOutputBtn2?.addEventListener('click',grantPendingOutputPermission);els.resetOutputBtn.addEventListener('click',resetOutputFolder);els.reviewModeBtn.addEventListener('click',toggleReviewMode);
if(els.outputDropZone){els.outputDropZone.addEventListener('dragover',e=>{e.preventDefault();els.outputDropZone.classList.add('dragover');});els.outputDropZone.addEventListener('dragleave',()=>els.outputDropZone.classList.remove('dragover'));els.outputDropZone.addEventListener('drop',handleOutputDrop);}
// Presets
els.presetSelect.addEventListener('change',applyPresetSelection);els.autoBeforeInput.addEventListener('input',()=>{els.presetSelect.value='custom';updatePresetLabels();});els.autoAfterInput.addEventListener('input',()=>{els.presetSelect.value='custom';updatePresetLabels();});
els.applyPresetAllBtn.addEventListener('click',()=>{const p=PRESETS[els.presetSelect.value];if(!p)return alert('เลือก Preset ก่อน');state.files.forEach(f=>f.rotation=p.rotation);applyPreviewRotation();renderFiles();});
// Navigation/review
els.prevBtn.addEventListener('click',()=>navigate(-1));els.nextBtn.addEventListener('click',()=>navigate(1, true));els.keepBtn.addEventListener('click',()=>setReviewStatus('keep'));els.favoriteBtn.addEventListener('click',()=>setReviewStatus('favorite'));els.rejectBtn.addEventListener('click',()=>setReviewStatus('reject'));els.autoTrimBtn.addEventListener('click',autoTrimCurrent);
// Rotation
els.rotateLeftBtn.addEventListener('click',()=>setRotation(270));els.rotateResetBtn.addEventListener('click',()=>setRotation(0));els.rotateRightBtn.addEventListener('click',()=>setRotation(90));els.rotate180Btn.addEventListener('click',()=>setRotation(180));
els.applyRotationAllBtn.addEventListener('click',()=>{const item=currentItem();if(!item)return;state.files.forEach(f=>f.rotation=item.rotation);renderFiles();els.processMessage.textContent=`ใช้ ${rotationLabel(item.rotation)} กับทุกคลิปแล้ว`;});
// Trim
els.startRange.addEventListener('input',()=>setTrimStart(Number(els.startRange.value)));els.endRange.addEventListener('input',()=>setTrimEnd(Number(els.endRange.value)));els.setStartBtn.addEventListener('click',()=>setTrimStart(els.previewVideo.currentTime));els.setEndBtn.addEventListener('click',()=>setTrimEnd(els.previewVideo.currentTime));
els.jumpStartBtn.addEventListener('click',()=>{const i=currentItem();if(i)els.previewVideo.currentTime=i.trimStart;});els.jumpEndBtn.addEventListener('click',()=>{const i=currentItem();if(i)els.previewVideo.currentTime=Math.max(0,i.trimEnd-.01);});
els.clearTrimBtn.addEventListener('click',()=>{const i=currentItem();if(!i?.duration)return;i.trimStart=0;i.trimEnd=i.duration;updateTrimUI();renderFiles();});
els.previewSelectionBtn.addEventListener('click',async()=>{const i=currentItem();if(!i?.duration)return;state.previewingSelection=true;els.previewVideo.currentTime=i.trimStart;try{await els.previewVideo.play();}catch{}});
els.analyzeKeyframesBtn.addEventListener('click',analyzeCurrentKeyframes);els.snapStartKeyBtn.addEventListener('click',()=>{const i=currentItem(),t=nearestKeyframe(i?.trimStart??0,'before');if(t!==null)setTrimStart(t,true);});els.snapEndKeyBtn.addEventListener('click',()=>{const i=currentItem(),t=nearestKeyframe(i?.trimEnd??0,'after');if(t!==null)setTrimEnd(t,true);});
bindStoryHandle(els.trimStartHandle,'start');bindStoryHandle(els.trimEndHandle,'end');
els.trimTimeline.addEventListener('pointerdown',e=>{if(state.processing||!currentItem()?.duration||e.target.closest('.story-handle'))return;els.previewVideo.currentTime=timelineTimeFromClientX(e.clientX);state.previewingSelection=false;updateStoryTimeline();});
els.trimTimeline.addEventListener('pointermove',e=>updateTimelineHover(e.clientX));els.trimTimeline.addEventListener('pointerleave',()=>els.timelineHover.classList.add('hidden'));
// video
els.previewVideo.addEventListener('timeupdate',()=>{els.currentTimeText.textContent=formatTime(els.previewVideo.currentTime||0);updateStoryTimeline();const i=currentItem();if(state.previewingSelection&&i&&els.previewVideo.currentTime>=i.trimEnd){els.previewVideo.pause();els.previewVideo.currentTime=i.trimStart;state.previewingSelection=false;}});
els.previewVideo.addEventListener('pause',()=>{if(!state.previewingSelection)return;const i=currentItem();if(i&&els.previewVideo.currentTime<i.trimEnd-.05)state.previewingSelection=false;});
// Selection/filter
els.clipSelected.addEventListener('change',()=>{const i=currentItem();if(!i||state.processing)return;i.selected=els.clipSelected.checked;renderFiles();updateSummary();resetProgress();});
els.selectAllBtn.addEventListener('click',()=>{state.files.forEach(i=>i.selected=true);renderFiles();updateSummary();});els.selectNoneBtn.addEventListener('click',()=>{state.files.forEach(i=>i.selected=false);renderFiles();updateSummary();});
els.filterSelect.addEventListener('change',()=>{renderFiles();updateSummary();});els.searchInput.addEventListener('input',()=>{renderFiles();updateSummary();});
// Export
els.startBtn.addEventListener('click',processAll);els.retryFailedBtn.addEventListener('click',retryFailed);els.cancelBtn.addEventListener('click',()=>{state.cancelRequested=true;els.cancelBtn.disabled=true;els.cancelBtn.textContent='กำลังยกเลิก…';els.processMessage.textContent='จะหยุดหลังไฟล์ปัจจุบัน';});els.openOutputBtn.addEventListener('click',showOutputLocation);
[els.photographerCode,els.sequenceStart,els.sequenceDigits].forEach(el=>{
  const eventName=el===els.photographerCode?'input':'change';
  el.addEventListener(eventName,()=>{state.files.forEach(f=>f.plannedOutputName=null);updateFilenamePreview();});
});
updateFilenamePreview();

window.addEventListener('keydown',e=>{
  const tag=e.target?.tagName?.toLowerCase();if(['input','select','textarea','button'].includes(tag)||e.target?.isContentEditable||state.processing)return;const item=currentItem();if(!item)return;
  if(e.code==='Space'){e.preventDefault();els.previewVideo.paused?els.previewVideo.play().catch(()=>{}):els.previewVideo.pause();return;}
  if(e.key==='ArrowLeft'){e.preventDefault();navigate(-1);return;} if(e.key==='ArrowRight'){e.preventDefault();navigate(1);return;}
  const k=e.key.toLowerCase();if(k==='k'){e.preventDefault();setReviewStatus('keep',true);}else if(k==='x'){e.preventDefault();setReviewStatus('reject',true);}else if(k==='f'){e.preventDefault();setReviewStatus('favorite',true);}else if(k==='i'){e.preventDefault();setTrimStart(els.previewVideo.currentTime);}else if(k==='o'){e.preventDefault();setTrimEnd(els.previewVideo.currentTime);}else if(k==='t'){e.preventDefault();autoTrimCurrent();}else if(k==='r'){e.preventDefault();const seq=[0,90,180,270],idx=seq.indexOf(item.rotation);setRotation(seq[(idx+1)%seq.length]);}
});

window.addEventListener('beforeunload',()=>{if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.trimWorker?.terminate();});

resetFilmstrip();updatePresetLabels();updateSummary();updateSelectionUI();
