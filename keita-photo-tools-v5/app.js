(() => {
  'use strict';

  const core = window.KeitaExifCore;
  if (!core) throw new Error('ไม่พบ EXIF core');

  const $ = (id) => document.getElementById(id);
  const PREVIEW_LIMIT = 100;
  const SCAN_BYTES_FIRST = 512 * 1024;
  const SCAN_BYTES_FALLBACK = 2 * 1024 * 1024;

  const state = {
    items: [],
    outputHandle: null,
    cancelled: false,
    scanning: false,
    firstValidDateMs: null,
    autoAnalysing: false,
    autoCancelled: false,
    vision: { faceModel: null, personModel: null, loading: null, ready: false, failed: false, error: null },
  };

  const els = {
    fileInput: $('fileInput'), folderInput: $('folderInput'), clearBtn: $('clearBtn'),
    fileCount: $('fileCount'), totalSize: $('totalSize'), exifCount: $('exifCount'), detectedTimezone: $('detectedTimezone'),
    cameraCard: $('cameraCard'), cameraModel: $('cameraModel'), imageDimensions: $('imageDimensions'), firstExifDate: $('firstExifDate'), firstTimezone: $('firstTimezone'),
    scanProgressWrap: $('scanProgressWrap'), scanProgressBar: $('scanProgressBar'), scanProgressText: $('scanProgressText'),
    renameEnabled: $('renameEnabled'), renameControls: $('renameControls'), keepOriginal: $('keepOriginal'), fixedText: $('fixedText'),
    photographerCode: $('photographerCode'), separator: $('separator'), startNumber: $('startNumber'), digits: $('digits'),
    renameBefore: $('renameBefore'), renameAfter: $('renameAfter'),
    autoEditEnabled: $('autoEditEnabled'), autoEditControls: $('autoEditControls'), autoStrength: $('autoStrength'), subjectAware: $('subjectAware'), autoAnalyzeBtn: $('autoAnalyzeBtn'), autoResetBtn: $('autoResetBtn'),
    autoAnalyzedCount: $('autoAnalyzedCount'), autoProgressWrap: $('autoProgressWrap'), autoProgressBar: $('autoProgressBar'), autoProgressText: $('autoProgressText'), autoPreview: $('autoPreview'),
    aiModelStatusBox: $('aiModelStatusBox'), aiModelStatus: $('aiModelStatus'), aiModelDetail: $('aiModelDetail'), autoBrightCount: $('autoBrightCount'), autoKeepCount: $('autoKeepCount'), autoDarkCount: $('autoDarkCount'),
    resizeEnabled: $('resizeEnabled'), resizeControls: $('resizeControls'), longEdge: $('longEdge'), fileLimitMb: $('fileLimitMb'), minQuality: $('minQuality'), noUpscale: $('noUpscale'),
    resizeBefore: $('resizeBefore'), resizeAfter: $('resizeAfter'), resizeHint: $('resizeHint'),
    dateFixEnabled: $('dateFixEnabled'), dateMainControls: $('dateMainControls'), targetDate: $('targetDate'),
    setDateMode: $('setDateMode'), setDateTimeMode: $('setDateTimeMode'), offsetMode: $('offsetMode'),
    targetDateTimeDate: $('targetDateTimeDate'), targetDateTimeTime: $('targetDateTimeTime'), preserveIntervals: $('preserveIntervals'),
    offsetDays: $('offsetDays'), offsetHours: $('offsetHours'), offsetMinutes: $('offsetMinutes'), offsetSeconds: $('offsetSeconds'), updateAllDates: $('updateAllDates'),
    timezoneFixEnabled: $('timezoneFixEnabled'), timezoneControls: $('timezoneControls'), targetTimezone: $('targetTimezone'), customTimezoneWrap: $('customTimezoneWrap'), customTimezone: $('customTimezone'),
    dateBefore: $('dateBefore'), dateAfter: $('dateAfter'), timezoneBefore: $('timezoneBefore'), timezoneAfter: $('timezoneAfter'),
    previewBody: $('previewBody'), previewSummary: $('previewSummary'), validationBox: $('validationBox'),
    chooseOutputBtn: $('chooseOutputBtn'), folderStatus: $('folderStatus'), browserWarning: $('browserWarning'),
    testResizeBtn: $('testResizeBtn'), exportBtn: $('exportBtn'), cancelBtn: $('cancelBtn'), exportProgressWrap: $('exportProgressWrap'), exportProgressBar: $('exportProgressBar'), exportProgressText: $('exportProgressText'), resultBox: $('resultBox'),
  };

  function init() {
    setTodayDefaults();
    bindEvents();
    checkBrowserSupport();
    syncControls();
    renderStats();
    updateRenameExample();
    updatePreview();
  }

  function setTodayDefaults() {
    const now = new Date();
    const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    els.targetDate.value = date;
    els.targetDateTimeDate.value = date;
    els.targetDateTimeTime.value = time;
  }

  function bindEvents() {
    els.fileInput.addEventListener('change', (e) => loadFiles(e.target.files));
    els.folderInput.addEventListener('change', (e) => loadFiles(e.target.files));
    els.clearBtn.addEventListener('click', clearFiles);

    [els.renameEnabled, els.keepOriginal, els.fixedText, els.photographerCode, els.separator, els.startNumber, els.digits]
      .forEach((el) => el.addEventListener('input', () => { syncControls(); updateRenameExample(); updatePreview(); }));

    els.autoEditEnabled.addEventListener('change', () => { syncControls(); updatePreview(); });
    els.autoStrength.addEventListener('change', () => { invalidateAutoAnalysis(); updatePreview(); });
    els.subjectAware.addEventListener('change', () => { invalidateAutoAnalysis(); updateAiModelStatus(); updatePreview(); });
    els.autoAnalyzeBtn.addEventListener('click', analyzeAlbumAuto);
    els.autoResetBtn.addEventListener('click', resetAutoAnalysis);

    [els.resizeEnabled, els.longEdge, els.fileLimitMb, els.minQuality, els.noUpscale]
      .forEach((el) => el.addEventListener('input', () => { syncControls(); updatePreview(); }));

    els.dateFixEnabled.addEventListener('change', () => { syncControls(); updatePreview(); });
    document.querySelectorAll('input[name="dateMode"]').forEach((radio) => radio.addEventListener('change', () => { syncControls(); updatePreview(); }));
    [els.targetDate, els.targetDateTimeDate, els.targetDateTimeTime, els.preserveIntervals, els.offsetDays, els.offsetHours, els.offsetMinutes, els.offsetSeconds, els.updateAllDates]
      .forEach((el) => el.addEventListener('input', updatePreview));

    els.timezoneFixEnabled.addEventListener('change', () => { syncControls(); updatePreview(); });
    els.targetTimezone.addEventListener('change', () => { syncControls(); updatePreview(); });
    els.customTimezone.addEventListener('input', updatePreview);

    els.chooseOutputBtn.addEventListener('click', chooseOutputFolder);
    els.testResizeBtn.addEventListener('click', testFirstPhoto);
    els.exportBtn.addEventListener('click', exportAll);
    els.cancelBtn.addEventListener('click', () => { state.cancelled = true; });
  }

  function checkBrowserSupport() {
    if (!('showDirectoryPicker' in window)) {
      els.browserWarning.classList.remove('hidden');
      els.browserWarning.textContent = 'เบราว์เซอร์นี้ยังไม่รองรับ Folder Export โดยตรง แนะนำ Chrome หรือ Edge บนคอมพิวเตอร์';
      els.chooseOutputBtn.disabled = true;
      return;
    }
    if (!window.isSecureContext) {
      els.browserWarning.classList.remove('hidden');
      els.browserWarning.textContent = 'Folder Export ต้องเปิดผ่าน HTTPS หรือ localhost แนะนำ GitHub Pages หรือเปิดผ่าน http://localhost';
    }
  }

  function syncControls() {
    els.renameControls.classList.toggle('disabled-area', !els.renameEnabled.checked);
    els.autoEditControls.classList.toggle('disabled-area', !els.autoEditEnabled.checked);
    els.resizeControls.classList.toggle('disabled-area', !els.resizeEnabled.checked);
    els.dateMainControls.classList.toggle('disabled-area', !els.dateFixEnabled.checked);
    els.timezoneControls.classList.toggle('disabled-area', !els.timezoneFixEnabled.checked);

    const mode = getDateMode();
    els.setDateMode.classList.toggle('hidden', mode !== 'setDate');
    els.setDateTimeMode.classList.toggle('hidden', mode !== 'setDateTime');
    els.offsetMode.classList.toggle('hidden', mode !== 'offset');

    const custom = els.targetTimezone.value === 'custom';
    els.customTimezoneWrap.classList.toggle('hidden', !custom);
    updateAutoUi();
    updateAiModelStatus();
    updateValidation();
  }

  async function loadFiles(fileList) {
    if (state.scanning) return;
    const files = Array.from(fileList || []).filter(isJpeg);
    if (!files.length) {
      showResult('ไม่พบไฟล์ JPG/JPEG ในรายการที่เลือก', false);
      return;
    }

    state.items = files
      .sort((a, b) => naturalCompare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name))
      .map((file, index) => ({ file, index, meta: null, scanError: null, exportError: null, outputInfo: null, autoEdit: null }));
    state.firstValidDateMs = null;
    state.outputHandle = null;
    state.autoCancelled = false;
    els.folderStatus.textContent = 'ยังไม่ได้เลือกโฟลเดอร์ · ระบบจะสร้าง KEITA_EXPORT_วันที่_เวลา ภายในโฟลเดอร์ที่เลือก';
    showResult('', true);

    renderStats();
    updatePreview();
    await scanMetadata();
    initializeDateInputsFromFirstPhoto();
    renderStats();
    updateAutoUi();
    updatePreview();
  }

  function clearFiles() {
    if (state.scanning) return;
    state.items = [];
    state.outputHandle = null;
    state.firstValidDateMs = null;
    state.autoCancelled = false;
    els.fileInput.value = '';
    els.folderInput.value = '';
    els.folderStatus.textContent = 'ยังไม่ได้เลือกโฟลเดอร์ · ระบบจะสร้าง KEITA_EXPORT_วันที่_เวลา ภายในโฟลเดอร์ที่เลือก';
    renderStats();
    updateAutoUi();
    updatePreview();
    showResult('', true);
  }

  async function scanMetadata() {
    if (!state.items.length) return;
    state.scanning = true;
    els.scanProgressWrap.classList.remove('hidden');
    els.scanProgressBar.style.width = '0%';

    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      try {
        item.meta = await inspectFile(item.file);
        item.scanError = null;
      } catch (error) {
        item.scanError = error.message || String(error);
        item.meta = null;
      }
      const done = i + 1;
      const pct = Math.round((done / state.items.length) * 100);
      els.scanProgressBar.style.width = `${pct}%`;
      els.scanProgressText.textContent = `กำลังอ่าน EXIF ${done.toLocaleString('th-TH')} / ${state.items.length.toLocaleString('th-TH')}`;
      if (done % 6 === 0) await yieldToBrowser();
    }

    state.scanning = false;
    computeFirstValidDate();
    els.scanProgressText.textContent = `อ่าน EXIF เสร็จแล้ว ${state.items.length.toLocaleString('th-TH')} ไฟล์`;
    setTimeout(() => els.scanProgressWrap.classList.add('hidden'), 900);
  }

  async function inspectFile(file) {
    let size = Math.min(file.size, SCAN_BYTES_FIRST);
    let buffer = await file.slice(0, size).arrayBuffer();
    let meta = core.inspect(buffer);
    if (!meta.hasExif && file.size > size) {
      size = Math.min(file.size, SCAN_BYTES_FALLBACK);
      buffer = await file.slice(0, size).arrayBuffer();
      meta = core.inspect(buffer);
    }
    return meta;
  }

  function computeFirstValidDate() {
    const first = state.items.find((item) => getBaseExifDate(item));
    const parsed = first ? parseExifDate(getBaseExifDate(first)) : null;
    state.firstValidDateMs = parsed ? partsToUtcMs(parsed) : null;
  }

  function initializeDateInputsFromFirstPhoto() {
    const first = state.items.find((item) => getBaseExifDate(item));
    if (!first) return;
    const p = parseExifDate(getBaseExifDate(first));
    if (!p) return;
    const date = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
    const time = `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
    els.targetDate.value = date;
    els.targetDateTimeDate.value = date;
    els.targetDateTimeTime.value = time;
  }

  function renderStats() {
    const total = state.items.reduce((sum, item) => sum + item.file.size, 0);
    const exifItems = state.items.filter((item) => getBaseExifDate(item));
    const timezones = [...new Set(state.items.map((item) => getBaseTimezone(item)).filter(Boolean))];

    els.fileCount.textContent = state.items.length.toLocaleString('th-TH');
    els.totalSize.textContent = formatBytes(total);
    els.exifCount.textContent = exifItems.length.toLocaleString('th-TH');
    els.detectedTimezone.textContent = timezones.length === 0 ? '—' : timezones.length === 1 ? timezones[0] : `${timezones.length} ค่า`;

    const first = state.items.find((item) => item.meta) || null;
    if (!first) {
      els.cameraCard.classList.add('hidden');
      return;
    }
    els.cameraCard.classList.remove('hidden');
    const makeModel = [first.meta?.make, first.meta?.model].filter(Boolean).join(' ') || 'ไม่พบข้อมูล';
    els.cameraModel.textContent = makeModel;
    els.imageDimensions.textContent = first.meta?.width && first.meta?.height ? `${first.meta.width} × ${first.meta.height}` : 'ไม่พบข้อมูล';
    els.firstExifDate.textContent = getBaseExifDate(first) ? formatExifForDisplay(getBaseExifDate(first)) : 'ไม่พบข้อมูล';
    els.firstTimezone.textContent = getBaseTimezone(first) || 'ไม่พบข้อมูล';
  }

  function isJpeg(file) {
    return /\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg';
  }

  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  function updateRenameExample() {
    const sample = state.items[0]?.file?.name || 'KPC00001.JPG';
    els.renameBefore.textContent = sample;
    els.renameAfter.textContent = buildOutputName(sample, 0);
  }

  function buildOutputName(originalName, index) {
    if (!els.renameEnabled.checked) return originalName;
    const { base, ext } = splitName(originalName);
    const original = els.keepOriginal.value === 'yes' ? base : '';
    const fixed = sanitizeFilenamePart(els.fixedText.value);
    const code = sanitizeFilenamePart(els.photographerCode.value);
    const sep = sanitizeFilenamePart(els.separator.value, true);
    const start = Math.max(0, safeInt(els.startNumber.value));
    const digits = clamp(safeInt(els.digits.value) || 3, 1, 8);
    const run = String(start + index).padStart(digits, '0');
    const newBase = `${original}${fixed}${code}${sep}${run}` || `${base}-${run}`;
    return `${newBase}${ext || '.JPG'}`;
  }

  function splitName(name) {
    const idx = name.lastIndexOf('.');
    return idx <= 0 ? { base: name, ext: '' } : { base: name.slice(0, idx), ext: name.slice(idx) };
  }

  function sanitizeFilenamePart(value, allowSymbols = false) {
    let s = String(value ?? '').trim().replace(/[\\/:*?"<>|]/g, '');
    if (!allowSymbols) s = s.replace(/\s+/g, '');
    return s;
  }

  function getDateMode() {
    return document.querySelector('input[name="dateMode"]:checked')?.value || 'setDate';
  }

  function getBaseExifDate(item) {
    const m = item?.meta;
    return m?.dateTimeOriginal || m?.dateTimeDigitized || m?.dateTime || null;
  }

  function getBaseTimezone(item) {
    const m = item?.meta;
    return m?.offsetTimeOriginal || m?.offsetTimeDigitized || m?.offsetTime || null;
  }

  function computeNewExifDate(item) {
    const raw = getBaseExifDate(item);
    const parts = parseExifDate(raw);
    if (!parts) return null;

    const mode = getDateMode();
    if (mode === 'setDate') {
      const target = parseDateInput(els.targetDate.value);
      if (!target) return null;
      return formatExifParts({ ...parts, year: target.year, month: target.month, day: target.day });
    }

    if (mode === 'setDateTime') {
      const target = parseDateTimeInputs(els.targetDateTimeDate.value, els.targetDateTimeTime.value);
      if (!target) return null;
      let ms = partsToUtcMs(target);
      if (els.preserveIntervals.checked && Number.isFinite(state.firstValidDateMs)) {
        ms += partsToUtcMs(parts) - state.firstValidDateMs;
      }
      return formatExifParts(utcMsToParts(ms));
    }

    const deltaSeconds = safeInt(els.offsetSeconds.value)
      + safeInt(els.offsetMinutes.value) * 60
      + safeInt(els.offsetHours.value) * 3600
      + safeInt(els.offsetDays.value) * 86400;
    const ms = partsToUtcMs(parts) + deltaSeconds * 1000;
    return formatExifParts(utcMsToParts(ms));
  }

  function parseExifDate(raw) {
    const m = String(raw || '').match(/^(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const p = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +m[6] };
    return isValidDateParts(p) ? p : null;
  }

  function parseDateInput(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const p = { year: +m[1], month: +m[2], day: +m[3], hour: 0, minute: 0, second: 0 };
    return isValidDateParts(p) ? { year: p.year, month: p.month, day: p.day } : null;
  }

  function parseDateTimeInputs(dateValue, timeValue) {
    const d = parseDateInput(dateValue);
    const m = String(timeValue || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!d || !m) return null;
    const p = { ...d, hour: +m[1], minute: +m[2], second: +(m[3] || 0) };
    return isValidDateParts(p) ? p : null;
  }

  function isValidDateParts(p) {
    if (![p.year, p.month, p.day, p.hour, p.minute, p.second].every(Number.isFinite)) return false;
    if (p.year < 1900 || p.year > 9999 || p.month < 1 || p.month > 12 || p.day < 1 || p.day > 31 || p.hour < 0 || p.hour > 23 || p.minute < 0 || p.minute > 59 || p.second < 0 || p.second > 59) return false;
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
    return d.getUTCFullYear() === p.year && d.getUTCMonth() + 1 === p.month && d.getUTCDate() === p.day && d.getUTCHours() === p.hour && d.getUTCMinutes() === p.minute && d.getUTCSeconds() === p.second;
  }

  function partsToUtcMs(p) {
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }

  function utcMsToParts(ms) {
    const d = new Date(ms);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
  }

  function formatExifParts(p) {
    return `${String(p.year).padStart(4, '0')}:${pad2(p.month)}:${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
  }

  function formatExifForDisplay(raw) {
    const p = parseExifDate(raw);
    if (!p) return raw || 'ไม่พบข้อมูล';
    return `${pad2(p.day)}/${pad2(p.month)}/${p.year} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
  }

  function getTargetTimezone() {
    const value = els.targetTimezone.value === 'custom' ? els.customTimezone.value.trim() : els.targetTimezone.value;
    return isValidTimezone(value) ? value : null;
  }

  function isValidTimezone(value) {
    const m = String(value || '').match(/^([+-])(\d{2}):(\d{2})$/);
    if (!m) return false;
    const hours = +m[2], minutes = +m[3];
    return hours <= 23 && minutes <= 59;
  }

  function getAutoStrength() {
    const value = Number.parseFloat(els.autoStrength.value);
    return Number.isFinite(value) ? clamp(value, 0.5, 1.5) : 0.8;
  }

  function invalidateAutoAnalysis() {
    state.items.forEach((item) => { item.autoEdit = null; });
    updateAutoUi();
  }

  function resetAutoAnalysis() {
    state.autoCancelled = true;
    state.items.forEach((item) => { item.autoEdit = null; });
    state.autoAnalysing = false;
    updateAutoUi();
    updatePreview();
    showResult('ล้างค่า Auto Edit แล้ว', true);
  }

  function updateAiModelStatus(message = null, detail = null, mode = null) {
    if (!els.aiModelStatus) return;
    const box = els.aiModelStatusBox;
    if (!els.subjectAware.checked) {
      els.aiModelStatus.textContent = 'Scene Histogram';
      els.aiModelDetail.textContent = 'ปิด Face / Person AI — ใช้แสงภาพรวมเท่านั้น';
      box?.classList.remove('ready', 'loading', 'error');
      return;
    }
    if (message) {
      els.aiModelStatus.textContent = message;
      if (detail !== null) els.aiModelDetail.textContent = detail;
      box?.classList.remove('ready', 'loading', 'error');
      if (mode) box?.classList.add(mode);
      return;
    }
    if (state.vision.ready) {
      els.aiModelStatus.textContent = 'Face + Person AI พร้อม';
      els.aiModelDetail.textContent = 'วิเคราะห์ใน Browser · รูปไม่ถูกอัปโหลด';
      box?.classList.remove('loading', 'error');
      box?.classList.add('ready');
    } else if (state.vision.loading) {
      els.aiModelStatus.textContent = 'กำลังโหลด AI…';
      els.aiModelDetail.textContent = 'ครั้งแรกอาจใช้เวลาสักครู่';
      box?.classList.remove('ready', 'error');
      box?.classList.add('loading');
    } else if (state.vision.failed) {
      els.aiModelStatus.textContent = 'AI โหลดไม่สำเร็จ';
      els.aiModelDetail.textContent = 'ใช้ Histogram เป็นระบบสำรอง · ตรวจอินเทอร์เน็ตหากต้องการ Face/Person';
      box?.classList.remove('ready', 'loading');
      box?.classList.add('error');
    } else {
      els.aiModelStatus.textContent = 'AI ยังไม่โหลด';
      els.aiModelDetail.textContent = 'โมเดลจะโหลดครั้งแรกเมื่อกด AUTO';
      box?.classList.remove('ready', 'loading', 'error');
    }
  }

  async function ensureVisionModels() {
    if (!els.subjectAware.checked) return false;
    if (state.vision.ready && state.vision.faceModel && state.vision.personModel) return true;
    if (state.vision.failed) return false;
    if (state.vision.loading) return state.vision.loading;

    state.vision.loading = (async () => {
      updateAiModelStatus('กำลังโหลด Face / Person AI…', 'ดาวน์โหลดโมเดลครั้งแรกเท่านั้น จากนั้น Browser มักเก็บ Cache ไว้', 'loading');
      try {
        if (!window.tf || !window.blazeface || !window.cocoSsd) {
          throw new Error('โหลด TensorFlow / AI library ไม่ครบ');
        }
        try {
          if (window.tf.getBackend && !window.tf.getBackend()) await window.tf.setBackend('webgl');
        } catch (_) {}
        await window.tf.ready();
        const [faceModel, personModel] = await Promise.all([
          window.blazeface.load(),
          window.cocoSsd.load({ base: 'lite_mobilenet_v2' }),
        ]);
        state.vision.faceModel = faceModel;
        state.vision.personModel = personModel;
        state.vision.ready = true;
        state.vision.failed = false;
        state.vision.error = null;
        updateAiModelStatus();
        return true;
      } catch (error) {
        state.vision.ready = false;
        state.vision.failed = true;
        state.vision.error = error.message || String(error);
        updateAiModelStatus();
        return false;
      } finally {
        state.vision.loading = null;
      }
    })();
    return state.vision.loading;
  }

  function updateAutoUi() {
    if (!els.autoAnalyzedCount) return;
    const edits = state.items.map((item) => item.autoEdit).filter(Boolean);
    const analyzed = edits.length;
    els.autoAnalyzedCount.textContent = `${analyzed.toLocaleString('th-TH')} / ${state.items.length.toLocaleString('th-TH')}`;
    els.autoResetBtn.disabled = analyzed === 0 || state.autoAnalysing;
    els.autoAnalyzeBtn.disabled = !state.items.length || state.scanning || !els.autoEditEnabled.checked;
    els.autoAnalyzeBtn.textContent = state.autoAnalysing ? 'หยุด Auto' : (analyzed === state.items.length && analyzed > 0 ? 'วิเคราะห์ใหม่ทั้งอัลบั้ม' : 'AUTO ทั้งอัลบั้ม');
    const first = state.items[0]?.autoEdit;
    els.autoPreview.textContent = first ? formatAutoEdit(first) : 'ยังไม่ได้วิเคราะห์';
    if (els.autoBrightCount) els.autoBrightCount.textContent = edits.filter((e) => e.decision === 'brighten').length.toLocaleString('th-TH');
    if (els.autoKeepCount) els.autoKeepCount.textContent = edits.filter((e) => e.decision === 'keep').length.toLocaleString('th-TH');
    if (els.autoDarkCount) els.autoDarkCount.textContent = edits.filter((e) => e.decision === 'darken').length.toLocaleString('th-TH');
  }

  async function analyzeAlbumAuto() {
    if (state.autoAnalysing) {
      state.autoCancelled = true;
      return;
    }
    if (!state.items.length || !els.autoEditEnabled.checked || state.scanning) return;

    state.autoAnalysing = true;
    state.autoCancelled = false;
    state.items.forEach((item) => { item.autoEdit = null; });
    els.autoProgressWrap.classList.remove('hidden');
    els.autoProgressBar.style.width = '0%';
    updateAutoUi();
    showResult('', true);

    const aiReady = els.subjectAware.checked ? await ensureVisionModels() : false;
    if (els.subjectAware.checked && !aiReady) {
      updateAiModelStatus('Face / Person AI ใช้งานไม่ได้', 'กำลังใช้ Scene Histogram เป็นระบบสำรอง', 'error');
    }

    let doneCount = 0;
    let failedCount = 0;
    const errors = [];
    for (let i = 0; i < state.items.length; i++) {
      if (state.autoCancelled) break;
      const item = state.items[i];
      let decoded = null;
      try {
        decoded = await decodeJpegForResize(item.file);
        item.autoEdit = await analyzeAutoEditSmart(decoded.source, decoded.width, decoded.height, getAutoStrength(), aiReady);
        doneCount++;
      } catch (error) {
        failedCount++;
        item.autoEdit = null;
        if (errors.length < 5) errors.push(`${item.file.name}: ${error.message || error}`);
      } finally {
        if (decoded) decoded.cleanup();
      }
      const done = i + 1;
      const pct = Math.round((done / state.items.length) * 100);
      els.autoProgressBar.style.width = `${pct}%`;
      const decision = item.autoEdit ? formatDecisionShort(item.autoEdit) : 'ผิดพลาด';
      els.autoProgressText.textContent = `กำลังวิเคราะห์ ${done.toLocaleString('th-TH')} / ${state.items.length.toLocaleString('th-TH')} · ${item.file.name} · ${decision}`;
      updateAutoUi();
      if (done % 2 === 0) {
        if (window.tf?.nextFrame) await window.tf.nextFrame();
        else await yieldToBrowser();
      }
    }

    normalizeAlbumAuto();
    state.autoAnalysing = false;
    const stopped = state.autoCancelled;
    state.autoCancelled = false;
    els.autoProgressText.textContent = stopped
      ? `หยุดแล้ว · วิเคราะห์สำเร็จ ${doneCount.toLocaleString('th-TH')} รูป`
      : `วิเคราะห์เสร็จ ${doneCount.toLocaleString('th-TH')} รูป${failedCount ? ` · ผิดพลาด ${failedCount.toLocaleString('th-TH')}` : ''}`;
    setTimeout(() => { if (!state.autoAnalysing) els.autoProgressWrap.classList.add('hidden'); }, 1200);
    updateAutoUi();
    updatePreview();
    const decisions = summarizeDecisions();
    const errorText = errors.length ? `\n${errors.join('\n')}` : '';
    showResult(`${stopped ? 'หยุด Auto แล้ว' : 'Smart Auto วิเคราะห์เสร็จ'} · สว่างขึ้น ${decisions.brighten.toLocaleString('th-TH')} · คงเดิม ${decisions.keep.toLocaleString('th-TH')} · มืดลง ${decisions.darken.toLocaleString('th-TH')} · ผิดพลาด ${failedCount.toLocaleString('th-TH')}${errorText}`, failedCount === 0);
  }

  function summarizeDecisions() {
    const result = { brighten: 0, keep: 0, darken: 0 };
    for (const item of state.items) {
      const d = item.autoEdit?.decision;
      if (d && d in result) result[d]++;
    }
    return result;
  }

  async function analyzeAutoEditSmart(source, sourceWidth, sourceHeight, strength = 0.8, aiReady = false) {
    const maxEdge = aiReady ? 560 : 360;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = createWorkCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('สร้าง Canvas วิเคราะห์ Auto ไม่สำเร็จ');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);

    let subject = null;
    if (aiReady && els.subjectAware.checked) {
      try {
        subject = await detectPrimarySubject(canvas, width, height);
      } catch (_) {
        subject = null;
      }
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const global = computeRegionMetrics(imageData.data, width, height, { x: 0, y: 0, width, height });
    let subjectMetrics = null;
    if (subject?.box) {
      const roi = subject.type === 'face' ? shrinkFaceBox(subject.box, width, height) : upperBodyBox(subject.box, width, height);
      subjectMetrics = computeRegionMetrics(imageData.data, width, height, roi);
      subject.roi = roi;
    }
    releaseCanvas(canvas);

    if (!global?.count) throw new Error('อ่านข้อมูลภาพสำหรับ Auto ไม่สำเร็จ');

    const targetScene = 118;
    const sceneEv = clamp(log2(targetScene / Math.max(45, global.mean)), -0.30, 0.30);
    let subjectEv = 0;
    let subjectWeight = 0;
    let sourceType = 'scene';
    let targetSubject = null;

    if (subjectMetrics?.count && subject) {
      if (subject.type === 'face') {
        // ใบหน้าเป็น reference ที่ดีที่สุด แต่คุม correction ให้เบาเพื่อรักษา skin tone ต่างกัน
        targetSubject = 128;
        subjectEv = clamp(log2(targetSubject / Math.max(48, subjectMetrics.mean)), -0.28, 0.28);
        subjectWeight = 0.68;
        sourceType = 'face';
      } else {
        // upper-body ROI ลดอิทธิพลจากถนน/ฉากหลัง แต่เสื้อผ้ายังมีผล จึงให้น้ำหนักน้อยกว่าใบหน้า
        targetSubject = 116;
        subjectEv = clamp(log2(targetSubject / Math.max(42, subjectMetrics.mean)), -0.24, 0.24);
        subjectWeight = 0.52;
        sourceType = 'person';
      }
    }

    let exposureEv = subjectWeight ? (subjectEv * subjectWeight + sceneEv * (1 - subjectWeight)) : sceneEv;

    // Highlight safeguard: ถ้าส่วนสว่างใกล้ขาวล้น ให้ลดการดัน Exposure ขึ้น
    if (global.p98 >= 248 && exposureEv > 0) exposureEv *= 0.28;
    else if (global.p98 >= 244 && exposureEv > 0) exposureEv *= 0.55;
    // Shadow safeguard: ถ้าภาพมืดมากแต่ subject พอดี อย่าดันภาพรวมแรง
    if (subjectMetrics && subjectMetrics.mean >= 112 && global.p50 < 75 && exposureEv > 0.08) exposureEv = 0.08;
    // ถ้ากลางภาพสว่างจัด ให้พิจารณาลดเล็กน้อย
    if (global.p50 > 166) exposureEv = Math.min(exposureEv, -0.055);

    const maxEv = 0.28 * strength;
    exposureEv = clamp(exposureEv * strength, -maxEv, maxEv);
    // Deadband: ภาพที่ถ่ายมาพอดีไม่ควรถูกแตะ
    if (Math.abs(exposureEv) < 0.055) exposureEv = 0;

    const brightness = Math.pow(2, exposureEv);
    const range = global.p95 - global.p05;
    const avgSat = global.avgSat;

    let contrast = 1.0;
    if (range < 125) contrast = 1.065;
    else if (range < 160) contrast = 1.04;
    else if (range > 225) contrast = 0.985;
    if (global.p02 <= 4 && global.p98 >= 250) contrast = Math.min(contrast, 1.0);

    let saturation = 1.0;
    if (avgSat < 0.17) saturation = 1.045;
    else if (avgSat < 0.28) saturation = 1.025;
    else if (avgSat > 0.60) saturation = 0.975;

    const blend = (value) => 1 + (value - 1) * strength;
    const decision = exposureEv > 0.055 ? 'brighten' : exposureEv < -0.055 ? 'darken' : 'keep';
    return {
      brightness: clamp(brightness, 0.84, 1.20),
      contrast: clamp(blend(contrast), 0.96, 1.08),
      saturation: clamp(blend(saturation), 0.96, 1.06),
      exposureEv,
      decision,
      sourceType,
      subjectScore: subject?.score || 0,
      metrics: {
        global,
        subject: subjectMetrics,
        subjectBox: subject?.box || null,
        subjectRoi: subject?.roi || null,
        sceneEv,
        subjectEv: subjectWeight ? subjectEv : null,
      },
    };
  }

  async function detectPrimarySubject(canvas, width, height) {
    if (!state.vision.ready) return null;
    let faces = [];
    try {
      faces = await state.vision.faceModel.estimateFaces(canvas, false);
    } catch (_) {}
    const faceCandidates = (faces || []).map((face) => {
      const topLeft = pointToXY(face.topLeft);
      const bottomRight = pointToXY(face.bottomRight);
      if (!topLeft || !bottomRight) return null;
      const box = clampBox({ x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y }, width, height);
      const confidence = Array.isArray(face.probability) || ArrayBuffer.isView(face.probability) ? Number(face.probability[0]) : Number(face.probability || 0.9);
      return { type: 'face', box, confidence: Number.isFinite(confidence) ? confidence : 0.9, score: rankSubjectBox(box, width, height, confidence) };
    }).filter(Boolean).filter((f) => f.box.width >= 16 && f.box.height >= 16);
    if (faceCandidates.length) return faceCandidates.sort((a, b) => b.score - a.score)[0];

    let objects = [];
    try {
      objects = await state.vision.personModel.detect(canvas, 8, 0.45);
    } catch (_) {}
    const people = (objects || []).filter((o) => o.class === 'person' && o.score >= 0.45).map((o) => {
      const b = o.bbox || [];
      const box = clampBox({ x: +b[0] || 0, y: +b[1] || 0, width: +b[2] || 0, height: +b[3] || 0 }, width, height);
      return { type: 'person', box, confidence: o.score, score: rankSubjectBox(box, width, height, o.score) };
    }).filter((p) => p.box.width >= 24 && p.box.height >= 48);
    return people.length ? people.sort((a, b) => b.score - a.score)[0] : null;
  }

  function pointToXY(point) {
    if (!point) return null;
    if (Array.isArray(point) || ArrayBuffer.isView(point)) return { x: Number(point[0]), y: Number(point[1]) };
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: Number(point.x), y: Number(point.y) };
    return null;
  }

  function rankSubjectBox(box, width, height, confidence = 1) {
    const areaRatio = clamp((box.width * box.height) / Math.max(1, width * height), 0, 1);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dx = (cx - width / 2) / Math.max(1, width / 2);
    const dy = (cy - height / 2) / Math.max(1, height / 2);
    const center = clamp(1 - Math.sqrt(dx * dx + dy * dy) * 0.58, 0.25, 1);
    return (0.65 + areaRatio * 2.4) * center * clamp(confidence, 0.35, 1);
  }

  function clampBox(box, width, height) {
    const x = clamp(Math.floor(box.x), 0, Math.max(0, width - 1));
    const y = clamp(Math.floor(box.y), 0, Math.max(0, height - 1));
    const right = clamp(Math.ceil(box.x + box.width), x + 1, width);
    const bottom = clamp(Math.ceil(box.y + box.height), y + 1, height);
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }

  function shrinkFaceBox(box, width, height) {
    return clampBox({
      x: box.x + box.width * 0.12,
      y: box.y + box.height * 0.10,
      width: box.width * 0.76,
      height: box.height * 0.76,
    }, width, height);
  }

  function upperBodyBox(box, width, height) {
    return clampBox({
      x: box.x + box.width * 0.16,
      y: box.y + box.height * 0.05,
      width: box.width * 0.68,
      height: box.height * 0.52,
    }, width, height);
  }

  function computeRegionMetrics(data, imageWidth, imageHeight, region) {
    const box = clampBox(region, imageWidth, imageHeight);
    const hist = new Uint32Array(256);
    let lumSum = 0;
    let satSum = 0;
    let count = 0;
    // Sampling step ช่วยให้วิเคราะห์เร็วขึ้นเมื่อ ROI ใหญ่
    const pixelCount = box.width * box.height;
    const step = pixelCount > 150000 ? 2 : 1;
    for (let y = box.y; y < box.y + box.height; y += step) {
      for (let x = box.x; x < box.x + box.width; x += step) {
        const i = (y * imageWidth + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b), 0, 255);
        hist[lum]++;
        lumSum += lum;
        const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        satSum += maxC ? (maxC - minC) / maxC : 0;
        count++;
      }
    }
    if (!count) return null;
    return {
      count,
      mean: lumSum / count,
      avgSat: satSum / count,
      p02: histogramPercentile(hist, count, 0.02),
      p05: histogramPercentile(hist, count, 0.05),
      p50: histogramPercentile(hist, count, 0.50),
      p95: histogramPercentile(hist, count, 0.95),
      p98: histogramPercentile(hist, count, 0.98),
    };
  }

  function normalizeAlbumAuto() {
    const edits = state.items.map((item) => item.autoEdit).filter(Boolean);
    if (edits.length < 2) return;
    const median = (values) => {
      const a = [...values].sort((x, y) => x - y);
      const mid = Math.floor(a.length / 2);
      return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
    };
    const album = {
      brightness: median(edits.map((e) => e.brightness)),
      contrast: median(edits.map((e) => e.contrast)),
      saturation: median(edits.map((e) => e.saturation)),
    };
    // Exposure ที่ตัดสินจาก Face/Person คงค่าเดิม 92%; ดึงเข้ากลางอัลบั้มเพียง 8% เพื่อไม่ทำลายการตัดสินรายภาพ
    for (const edit of edits) {
      edit.brightness = edit.brightness * 0.92 + album.brightness * 0.08;
      edit.contrast = edit.contrast * 0.86 + album.contrast * 0.14;
      edit.saturation = edit.saturation * 0.86 + album.saturation * 0.14;
      edit.exposureEv = log2(Math.max(0.01, edit.brightness));
      edit.decision = edit.exposureEv > 0.055 ? 'brighten' : edit.exposureEv < -0.055 ? 'darken' : 'keep';
    }
  }

  function histogramPercentile(hist, total, fraction) {
    const target = Math.max(1, Math.ceil(total * fraction));
    let acc = 0;
    for (let i = 0; i < hist.length; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }

  function formatDecisionShort(edit) {
    if (!edit) return 'รอ AUTO';
    const ev = Math.abs(edit.exposureEv || 0).toFixed(2);
    if (edit.decision === 'brighten') return `สว่างขึ้น +${ev} EV`;
    if (edit.decision === 'darken') return `มืดลง -${ev} EV`;
    return 'คงแสงเดิม';
  }

  function formatAutoEdit(edit) {
    if (!edit) return 'รอ AUTO';
    const pct = (v) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
    const source = edit.sourceType === 'face' ? 'Face' : edit.sourceType === 'person' ? 'Person' : 'Scene';
    return `${formatDecisionShort(edit)} · ${source} · Contrast ${pct(edit.contrast)} · Color ${pct(edit.saturation)}`;
  }

  function buildAutoCanvasFilter(edit) {
    if (!edit) return 'none';
    return `brightness(${edit.brightness.toFixed(4)}) contrast(${edit.contrast.toFixed(4)}) saturate(${edit.saturation.toFixed(4)})`;
  }

  function log2(value) {
    return Math.log(value) / Math.LN2;
  }

  function getResizeSettings() {
    const longEdge = clamp(safeInt(els.longEdge.value) || 4500, 500, 12000);
    const fileLimitMb = Number.parseFloat(els.fileLimitMb.value);
    const minQuality = clamp(Number.parseFloat(els.minQuality.value) || 75, 40, 98);
    return {
      enabled: !!els.resizeEnabled.checked,
      longEdge,
      fileLimitMb: Number.isFinite(fileLimitMb) ? fileLimitMb : 4.8,
      fileLimitBytes: Math.round((Number.isFinite(fileLimitMb) ? fileLimitMb : 4.8) * 1024 * 1024),
      minQuality: minQuality / 100,
      noUpscale: !!els.noUpscale.checked,
    };
  }

  function getDisplayDimensions(meta) {
    if (!meta?.width || !meta?.height) return null;
    const orientation = Number(meta.orientation) || 1;
    const swap = orientation >= 5 && orientation <= 8;
    return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  }

  function calcTargetDimensions(width, height, longEdge, noUpscale = true) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const currentLong = Math.max(width, height);
    const targetLong = noUpscale ? Math.min(longEdge, currentLong) : longEdge;
    const scale = targetLong / currentLong;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
  }

  function getResizePreview(item) {
    if (!els.resizeEnabled.checked) return 'ไม่ Resize';
    const settings = getResizeSettings();
    const dims = getDisplayDimensions(item?.meta);
    if (!dims) return `Long Edge ${settings.longEdge}px · ≤ ${settings.fileLimitMb}MB`;
    const target = calcTargetDimensions(dims.width, dims.height, settings.longEdge, settings.noUpscale);
    const sameDims = target && target.width === dims.width && target.height === dims.height;
    const sizeFits = item?.file?.size <= settings.fileLimitBytes;
    if (sameDims && sizeFits && !els.autoEditEnabled.checked) return `${dims.width}×${dims.height} · เก็บ JPEG เดิม`;
    if (sameDims && els.autoEditEnabled.checked) return `${dims.width}×${dims.height} · Auto Edit · Re-encode`;
    return `${dims.width}×${dims.height} → ${target.width}×${target.height} · ≤ ${settings.fileLimitMb}MB`;
  }

  function updateResizeExample() {
    const settings = getResizeSettings();
    const first = state.items[0];
    if (!first) {
      els.resizeBefore.textContent = '—';
      els.resizeAfter.textContent = els.resizeEnabled.checked ? `Long Edge ${settings.longEdge}px` : 'ไม่ Resize';
      els.resizeHint.textContent = `Long Edge ${settings.longEdge.toLocaleString()} px · File Limit ${settings.fileLimitMb} MB · Min Q ${Math.round(settings.minQuality * 100)}%`;
      return;
    }
    const dims = getDisplayDimensions(first.meta);
    els.resizeBefore.textContent = dims ? `${dims.width} × ${dims.height} · ${formatBytes(first.file.size)}` : `${first.file.name} · ${formatBytes(first.file.size)}`;
    els.resizeAfter.textContent = getResizePreview(first);
    els.resizeHint.textContent = els.resizeEnabled.checked
      ? `Long Edge ${settings.longEdge.toLocaleString()} px · File Limit ${settings.fileLimitMb} MB · เลือก Quality สูงที่สุดอัตโนมัติ`
      : (els.autoEditEnabled.checked ? 'ปิด Resize · คงขนาดเดิม แต่ Auto Edit จะ Re-encode JPEG 1 ครั้ง' : 'ปิด Resize · จะไม่ Re-encode JPEG เพราะส่วนนี้');
  }

  function updatePreview() {
    updateRenameExample();
    updateResizeExample();
    if (!state.items.length) {
      els.previewBody.innerHTML = '<tr><td colspan="9" class="empty">เลือกรูปเพื่อดู Preview</td></tr>';
      els.previewSummary.textContent = 'ยังไม่มีไฟล์';
      els.dateBefore.textContent = 'ยังไม่มีข้อมูล';
      els.dateAfter.textContent = 'ยังไม่มีข้อมูล';
      els.timezoneBefore.textContent = 'TZ —';
      els.timezoneAfter.textContent = 'TZ —';
      updateValidation();
      return;
    }

    const first = state.items.find((item) => getBaseExifDate(item)) || state.items[0];
    const firstDate = getBaseExifDate(first);
    const firstTz = getBaseTimezone(first);
    els.dateBefore.textContent = firstDate ? formatExifForDisplay(firstDate) : 'ไม่พบ EXIF Date';
    const nextFirstDate = els.dateFixEnabled.checked ? computeNewExifDate(first) : firstDate;
    els.dateAfter.textContent = nextFirstDate ? formatExifForDisplay(nextFirstDate) : (els.dateFixEnabled.checked ? 'กรุณาตรวจค่าที่ตั้ง' : 'ไม่เปลี่ยน');
    els.timezoneBefore.textContent = `TZ ${firstTz || '—'}`;
    els.timezoneAfter.textContent = `TZ ${els.timezoneFixEnabled.checked ? (getTargetTimezone() || 'ไม่ถูกต้อง') : (firstTz || '—')}`;

    const rows = state.items.slice(0, PREVIEW_LIMIT).map((item, index) => {
      const outName = buildOutputName(item.file.name, index);
      const oldDateRaw = getBaseExifDate(item);
      const oldDate = oldDateRaw ? formatExifForDisplay(oldDateRaw) : 'ไม่พบ EXIF Date';
      let newDate = oldDate;
      let status = '<span class="status-ok">พร้อม</span>';

      if (els.dateFixEnabled.checked) {
        const next = computeNewExifDate(item);
        if (!oldDateRaw) {
          newDate = 'ไม่เปลี่ยน';
          status = '<span class="status-warn">ไม่มีวันที่เดิม</span>';
        } else if (!next) {
          newDate = 'ค่าที่ตั้งไม่ถูกต้อง';
          status = '<span class="status-error">ตรวจวันที่</span>';
        } else newDate = formatExifForDisplay(next);
      }

      const tzOld = getBaseTimezone(item) || '—';
      let tzText = tzOld;
      if (els.timezoneFixEnabled.checked) {
        const targetTz = getTargetTimezone();
        if (!targetTz) status = '<span class="status-error">ตรวจ Time Zone</span>';
        tzText = `${tzOld} → ${targetTz || '?'}`;
      }
      if (item.scanError) status = '<span class="status-warn">อ่าน EXIF ไม่ได้</span>';
      if (item.exportError) status = '<span class="status-error">Export ผิดพลาด</span>';

      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.file.name)}</td>
        <td>${escapeHtml(outName)}</td>
        <td>${escapeHtml(oldDate)}</td>
        <td>${escapeHtml(newDate)}</td>
        <td>${escapeHtml(tzText)}</td>
        <td class="resize-result">${escapeHtml(els.autoEditEnabled.checked ? formatAutoEdit(item.autoEdit) : 'ปิด')}</td>
        <td class="resize-result">${escapeHtml(item.outputInfo ? `${item.outputInfo.width}×${item.outputInfo.height} · ${formatBytes(item.outputInfo.size)} · Q${Math.round(item.outputInfo.quality * 100)}` : getResizePreview(item))}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');

    els.previewBody.innerHTML = rows;
    els.previewSummary.textContent = `${state.items.length.toLocaleString('th-TH')} ไฟล์`;
    updateValidation();
  }

  function getValidation() {
    const messages = [];
    let level = 'ok';
    const hasFiles = state.items.length > 0;
    const anyOperation = els.renameEnabled.checked || els.autoEditEnabled.checked || els.resizeEnabled.checked || els.dateFixEnabled.checked || els.timezoneFixEnabled.checked;

    if (!hasFiles) return { level: 'warn', blocking: true, messages: ['ยังไม่ได้เลือกรูป'] };
    if (state.scanning) return { level: 'warn', blocking: true, messages: ['กำลังอ่าน EXIF กรุณารอสักครู่'] };
    if (state.autoAnalysing) return { level: 'warn', blocking: true, messages: ['กำลัง Auto Edit ทั้งอัลบั้ม กรุณารอหรือกดหยุด Auto'] };
    if (!anyOperation) return { level: 'warn', blocking: true, messages: ['ยังไม่ได้เปิด Auto Edit, Rename, Resize, Date Fix หรือ Time Zone Fix'] };

    const outputNames = state.items.map((item, i) => buildOutputName(item.file.name, i));
    const duplicates = findDuplicates(outputNames.map((n) => n.toLowerCase()));
    if (duplicates.length) {
      level = 'error';
      messages.push(`ชื่อไฟล์ใหม่ซ้ำกัน เช่น ${duplicates.slice(0, 3).join(', ')}`);
    }

    if (els.autoEditEnabled.checked) {
      const analyzed = state.items.filter((item) => !!item.autoEdit).length;
      if (analyzed < state.items.length) {
        if (level !== 'error') level = 'warn';
        messages.push(`Auto Edit วิเคราะห์แล้ว ${analyzed.toLocaleString('th-TH')} / ${state.items.length.toLocaleString('th-TH')} รูป · รูปที่เหลือจะวิเคราะห์อัตโนมัติตอน Export`);
      }
    }

    if (els.resizeEnabled.checked) {
      const rs = getResizeSettings();
      if (!Number.isFinite(rs.longEdge) || rs.longEdge < 500 || rs.longEdge > 12000) {
        level = 'error'; messages.push('Long Edge ต้องอยู่ระหว่าง 500–12000 px');
      }
      if (!Number.isFinite(rs.fileLimitMb) || rs.fileLimitMb < 0.2 || rs.fileLimitMb > 50) {
        level = 'error'; messages.push('File Limit ต้องอยู่ระหว่าง 0.2–50 MB');
      }
      if (!Number.isFinite(rs.minQuality) || rs.minQuality < 0.4 || rs.minQuality > 0.98) {
        level = 'error'; messages.push('คุณภาพต่ำสุดต้องอยู่ระหว่าง 40–98%');
      }
    }

    if (els.dateFixEnabled.checked) {
      const mode = getDateMode();
      if (mode === 'setDate' && !parseDateInput(els.targetDate.value)) {
        level = 'error'; messages.push('วันที่ใหม่ไม่ถูกต้อง');
      }
      if (mode === 'setDateTime' && !parseDateTimeInputs(els.targetDateTimeDate.value, els.targetDateTimeTime.value)) {
        level = 'error'; messages.push('วัน/เวลาเริ่มต้นไม่ถูกต้อง');
      }
      const noDate = state.items.filter((item) => !getBaseExifDate(item)).length;
      if (noDate) {
        if (level !== 'error') level = 'warn';
        messages.push(`${noDate.toLocaleString('th-TH')} ไฟล์ไม่มี EXIF Date จึงจะข้ามการแก้วันที่`);
      }
    }

    if (els.timezoneFixEnabled.checked) {
      if (!getTargetTimezone()) {
        level = 'error'; messages.push('Time Zone ใหม่ไม่ถูกต้อง ต้องเป็นรูปแบบ +07:00 หรือ -05:00');
      }
      const noTzTag = state.items.filter((item) => !hasAnyTimezoneLocation(item)).length;
      if (noTzTag) {
        if (level !== 'error') level = 'warn';
        messages.push(`${noTzTag.toLocaleString('th-TH')} ไฟล์ไม่มี OffsetTime tag จึงจะข้ามการแก้ Time Zone`);
      }
    }

    if (!messages.length) messages.push('พร้อม Export · ไฟล์ต้นฉบับจะไม่ถูกแก้ทับ');
    return { level, blocking: level === 'error', messages };
  }

  function hasAnyTimezoneLocation(item) {
    const l = item?.meta?.locations || {};
    return !!(l.offsetTime || l.offsetTimeOriginal || l.offsetTimeDigitized);
  }

  function updateValidation() {
    const v = getValidation();
    els.validationBox.className = `validation ${v.level}`;
    els.validationBox.classList.remove('hidden');
    els.validationBox.textContent = v.messages.join(' · ');
    if (!state.items.length) els.validationBox.classList.add('hidden');
    validateReady(v);
  }

  function validateReady(validation = getValidation()) {
    const hasOutput = !!state.outputHandle;
    els.exportBtn.disabled = validation.blocking || !hasOutput || state.scanning || state.autoAnalysing;
    if (els.testResizeBtn) els.testResizeBtn.disabled = validation.blocking || state.scanning || state.autoAnalysing || !state.items.length;
  }

  async function chooseOutputFolder() {
    if (!window.showDirectoryPicker) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'keita-photo-export', startIn: 'pictures' });
      state.outputHandle = handle;
      els.folderStatus.textContent = `${handle.name || 'เลือกโฟลเดอร์แล้ว'} → ระบบจะสร้าง KEITA_EXPORT ใหม่ภายในโฟลเดอร์นี้`;
      updateValidation();
    } catch (error) {
      if (error?.name !== 'AbortError') showResult(`เลือกโฟลเดอร์ไม่สำเร็จ: ${error.message || error}`, false);
    }
  }

  async function testFirstPhoto() {
    if (!state.items.length || state.scanning) return;
    const item = state.items[0];
    els.testResizeBtn.disabled = true;
    showResult(`กำลังทดสอบ ${item.file.name}...`, true);
    try {
      const changes = {};
      if (els.dateFixEnabled.checked) {
        const newDate = computeNewExifDate(item);
        if (newDate && getBaseExifDate(item)) {
          changes.dateTimeOriginal = newDate;
          if (els.updateAllDates.checked) { changes.dateTimeDigitized = newDate; changes.dateTime = newDate; }
        }
      }
      if (els.timezoneFixEnabled.checked) {
        const tz = getTargetTimezone();
        if (tz && hasAnyTimezoneLocation(item)) { changes.offsetTime = tz; changes.offsetTimeOriginal = tz; changes.offsetTimeDigitized = tz; }
      }
      let result;
      if (els.resizeEnabled.checked || els.autoEditEnabled.checked) result = await resizeAndOptimizeJpeg(item, changes);
      else {
        const patched = Object.keys(changes).length ? await rewriteExifMetadata(item.file, changes) : { blob: item.file, changed: 0 };
        result = { blob: patched.blob, info: { width: getDisplayDimensions(item.meta)?.width || 0, height: getDisplayDimensions(item.meta)?.height || 0, size: patched.blob.size, quality: 1, reencoded: false } };
      }
      item.outputInfo = result.info;
      showResult(`ทดสอบผ่าน: ${item.file.name} → ${result.info.width}×${result.info.height} · ${formatBytes(result.blob.size)}${result.info.reencoded ? ` · Q${Math.round(result.info.quality * 100)}` : ' · ไม่ Re-encode'}`, true);
      updatePreview();
    } catch (error) {
      item.exportError = error.message || String(error);
      showResult(`ทดสอบไม่ผ่าน: ${item.file.name}\n${item.exportError}`, false);
      updatePreview();
    } finally {
      updateValidation();
    }
  }

  async function exportAll() {
    const validation = getValidation();
    if (validation.blocking || !state.outputHandle) return;

    state.cancelled = false;
    state.items.forEach((item) => { item.exportError = null; item.outputInfo = null; });
    els.exportBtn.disabled = true;
    els.cancelBtn.classList.remove('hidden');
    els.exportProgressWrap.classList.remove('hidden');
    els.exportProgressBar.style.width = '0%';
    showResult('', true);

    let exportDir;
    let exportDirName;
    try {
      ({ handle: exportDir, name: exportDirName } = await createSafeExportDirectory(state.outputHandle));
    } catch (error) {
      finishExportUI();
      showResult(`สร้างโฟลเดอร์ Export ไม่สำเร็จ: ${error.message || error}`, false);
      return;
    }

    let success = 0;
    let failed = 0;
    let dateSkipped = 0;
    let timezoneSkipped = 0;
    let metadataFilesChanged = 0;
    let reencodedFiles = 0;
    let preservedJpegFiles = 0;
    const qualityValues = [];
    const errorSamples = [];

    for (let i = 0; i < state.items.length; i++) {
      if (state.cancelled) break;
      const item = state.items[i];
      const outName = buildOutputName(item.file.name, i);

      try {
        const changes = {};
        if (els.dateFixEnabled.checked) {
          const newDate = computeNewExifDate(item);
          if (newDate && getBaseExifDate(item)) {
            changes.dateTimeOriginal = newDate;
            if (els.updateAllDates.checked) {
              changes.dateTimeDigitized = newDate;
              changes.dateTime = newDate;
            }
          } else dateSkipped++;
        }

        if (els.timezoneFixEnabled.checked) {
          const tz = getTargetTimezone();
          if (tz && hasAnyTimezoneLocation(item)) {
            changes.offsetTime = tz;
            changes.offsetTimeOriginal = tz;
            changes.offsetTimeDigitized = tz;
          } else timezoneSkipped++;
        }

        let blob = item.file;
        if (els.resizeEnabled.checked || els.autoEditEnabled.checked) {
          const processed = await resizeAndOptimizeJpeg(item, changes);
          blob = processed.blob;
          item.outputInfo = processed.info;
          if (processed.metadataChanged > 0) metadataFilesChanged++;
          if (processed.info.reencoded) {
            reencodedFiles++;
            qualityValues.push(processed.info.quality);
          } else {
            preservedJpegFiles++;
          }
        } else if (Object.keys(changes).length) {
          const patched = await rewriteExifMetadata(item.file, changes);
          blob = patched.blob;
          if (patched.changed > 0) metadataFilesChanged++;
        }

        await writeBlobToFolder(exportDir, outName, blob);
        success++;
      } catch (error) {
        failed++;
        item.exportError = error.message || String(error);
        if (errorSamples.length < 8) errorSamples.push(`${item.file.name}: ${item.exportError}`);
      }

      const done = i + 1;
      const pct = Math.round((done / state.items.length) * 100);
      els.exportProgressBar.style.width = `${pct}%`;
      els.exportProgressText.textContent = `${done.toLocaleString('th-TH')} / ${state.items.length.toLocaleString('th-TH')} · ${outName}`;
      if (done % 4 === 0) await yieldToBrowser();
    }

    finishExportUI();
    const cancelledText = state.cancelled ? ' · หยุดโดยผู้ใช้' : '';
    const extra = [];
    if (els.dateFixEnabled.checked) extra.push(`ข้าม Date Fix ${dateSkipped.toLocaleString('th-TH')}`);
    if (els.timezoneFixEnabled.checked) extra.push(`ข้าม Time Zone ${timezoneSkipped.toLocaleString('th-TH')}`);
    if (els.autoEditEnabled.checked) {
      const autoDone = state.items.filter((item) => !!item.autoEdit).length;
      extra.push(`Auto Edit ${autoDone.toLocaleString('th-TH')} ไฟล์`);
    }
    if (els.resizeEnabled.checked || els.autoEditEnabled.checked) {
      extra.push(`Re-encode ${reencodedFiles.toLocaleString('th-TH')} ไฟล์`);
      extra.push(`เก็บ JPEG เดิม ${preservedJpegFiles.toLocaleString('th-TH')} ไฟล์`);
      if (qualityValues.length) {
        const minQ = Math.round(Math.min(...qualityValues) * 100);
        const maxQ = Math.round(Math.max(...qualityValues) * 100);
        extra.push(`Quality Q${minQ}${maxQ !== minQ ? `–Q${maxQ}` : ''}`);
      }
    }
    extra.push(`แก้ metadata ${metadataFilesChanged.toLocaleString('th-TH')} ไฟล์`);
    const errorText = errorSamples.length ? `\n\nตัวอย่างข้อผิดพลาด:\n${errorSamples.join('\n')}` : '';
    showResult(`เสร็จแล้ว: ${exportDirName} · สำเร็จ ${success.toLocaleString('th-TH')} · ผิดพลาด ${failed.toLocaleString('th-TH')} · ${extra.join(' · ')}${cancelledText}${errorText}`, failed === 0);
    updatePreview();
  }

  function finishExportUI() {
    els.cancelBtn.classList.add('hidden');
    updateValidation();
  }

  async function rewriteExifMetadata(file, changes) {
    let prefixSize = Math.min(file.size, SCAN_BYTES_FIRST);
    let buffer = await file.slice(0, prefixSize).arrayBuffer();
    let parsed = core.inspect(buffer);
    if (!parsed.hasExif && file.size > prefixSize) {
      prefixSize = Math.min(file.size, SCAN_BYTES_FALLBACK);
      buffer = await file.slice(0, prefixSize).arrayBuffer();
      parsed = core.inspect(buffer);
    }
    if (!parsed.hasExif) return { blob: file, changed: 0, skipped: Object.keys(changes) };

    const patched = core.patchAscii(buffer, changes);
    if (!patched.changed) return { blob: file, changed: 0, skipped: patched.skipped };
    const blob = prefixSize >= file.size
      ? new Blob([patched.buffer], { type: file.type || 'image/jpeg' })
      : new Blob([patched.buffer, file.slice(prefixSize)], { type: file.type || 'image/jpeg' });
    return { blob, changed: patched.changed, skipped: patched.skipped };
  }

  async function resizeAndOptimizeJpeg(item, changes) {
    const settings = getResizeSettings();
    const autoEnabled = !!els.autoEditEnabled.checked;
    const resizeEnabled = !!els.resizeEnabled.checked;
    const knownDims = getDisplayDimensions(item.meta);

    // ถ้าไม่ได้แต่ง Auto และภาพไม่ต้องย่อ/ไม่เกิน Limit ให้เก็บ JPEG เดิม เพื่อไม่บีบซ้ำ
    if (resizeEnabled && !autoEnabled && knownDims) {
      const knownTarget = calcTargetDimensions(knownDims.width, knownDims.height, settings.longEdge, settings.noUpscale);
      const dimensionsSame = knownTarget.width === knownDims.width && knownTarget.height === knownDims.height;
      if (dimensionsSame && item.file.size <= settings.fileLimitBytes) {
        let blob = item.file;
        let metadataChanged = 0;
        if (Object.keys(changes).length) {
          const patched = await rewriteExifMetadata(item.file, changes);
          blob = patched.blob;
          metadataChanged = patched.changed;
        }
        return {
          blob,
          metadataChanged,
          info: { width: knownDims.width, height: knownDims.height, size: blob.size, quality: 1, reencoded: false, resized: false, autoEdit: null },
        };
      }
    }

    const decoded = await decodeJpegForResize(item.file);
    const source = decoded.source;
    try {
      if (autoEnabled && !item.autoEdit) {
        item.autoEdit = await analyzeAutoEditSmart(source, decoded.width, decoded.height, getAutoStrength(), els.subjectAware.checked ? await ensureVisionModels() : false);
        updateAutoUi();
      }

      const target = resizeEnabled
        ? calcTargetDimensions(decoded.width, decoded.height, settings.longEdge, settings.noUpscale)
        : { width: decoded.width, height: decoded.height, scale: 1 };
      if (!target) throw new Error('อ่านขนาดภาพไม่ได้');

      // Auto Edit และ Resize ถูกรวมในรอบวาดเดียว เพื่อลดการ Re-encode ซ้ำ
      const canvas = await highQualityResize(source, decoded.width, decoded.height, target.width, target.height, autoEnabled ? item.autoEdit : null);

      const exifSegment = await prepareExifSegment(item.file, changes, target.width, target.height);
      const metadataBytes = exifSegment ? exifSegment.byteLength : 0;
      const encoded = resizeEnabled
        ? await encodeForFileLimit(canvas, settings.fileLimitBytes, metadataBytes, settings.minQuality)
        : { blob: await canvasToJpegBlob(canvas, 0.96), quality: 0.96 };

      let outputBlob = encoded.blob;
      if (exifSegment) outputBlob = await insertExifSegment(outputBlob, exifSegment);
      releaseCanvas(canvas);

      if (resizeEnabled && outputBlob.size > settings.fileLimitBytes) {
        throw new Error(`ไฟล์หลังใส่ EXIF มีขนาด ${formatBytes(outputBlob.size)} เกิน Limit ${settings.fileLimitMb} MB`);
      }

      return {
        blob: outputBlob,
        metadataChanged: Object.keys(changes).length ? 1 : 0,
        info: {
          width: target.width,
          height: target.height,
          size: outputBlob.size,
          quality: encoded.quality,
          reencoded: true,
          resized: target.width !== decoded.width || target.height !== decoded.height,
          autoEdit: autoEnabled ? item.autoEdit : null,
        },
      };
    } finally {
      decoded.cleanup();
    }
  }

  async function decodeJpegForResize(file) {
    // วิธีที่ 1: createImageBitmap เร็วและใช้ RAM ดี
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => { try { bitmap.close(); } catch (_) {} } };
      } catch (_) {
        try {
          const bitmap = await createImageBitmap(file);
          return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => { try { bitmap.close(); } catch (_) {} } };
        } catch (_) {}
      }
    }

    // วิธีสำรอง: HTMLImageElement รองรับ JPEG จากกล้อง/Lightroom กว้างมาก
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.decoding = 'async';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('เบราว์เซอร์ถอดรหัส JPEG ไม่สำเร็จ'));
        el.src = url;
      });
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) throw new Error('อ่านขนาด JPEG ไม่สำเร็จ');
      return { source: img, width, height, cleanup: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function createWorkCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function highQualityResize(source, sourceWidth, sourceHeight, targetWidth, targetHeight, autoEdit = null) {
    if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
      const canvas = createWorkCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!ctx) throw new Error('สร้าง Canvas ไม่สำเร็จ');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (autoEdit) ctx.filter = buildAutoCanvasFilter(autoEdit);
      ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
      if (autoEdit) ctx.filter = 'none';
      return canvas;
    }

    // ย่อทีละครึ่งเมื่อ scale ต่างกันมาก แล้วจบที่ขนาดเป้าหมาย
    let currentSource = source;
    let currentWidth = sourceWidth;
    let currentHeight = sourceHeight;
    let ownedCanvas = null;

    while (currentWidth / 2 > targetWidth && currentHeight / 2 > targetHeight) {
      const nextWidth = Math.max(targetWidth, Math.round(currentWidth / 2));
      const nextHeight = Math.max(targetHeight, Math.round(currentHeight / 2));
      const stepCanvas = createWorkCanvas(nextWidth, nextHeight);
      const stepCtx = stepCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!stepCtx) throw new Error('สร้าง Canvas สำหรับย่อภาพไม่สำเร็จ');
      stepCtx.imageSmoothingEnabled = true;
      stepCtx.imageSmoothingQuality = 'high';
      stepCtx.drawImage(currentSource, 0, 0, currentWidth, currentHeight, 0, 0, nextWidth, nextHeight);
      if (ownedCanvas) releaseCanvas(ownedCanvas);
      ownedCanvas = stepCanvas;
      currentSource = stepCanvas;
      currentWidth = nextWidth;
      currentHeight = nextHeight;
      await yieldToBrowser();
    }

    const finalCanvas = createWorkCanvas(targetWidth, targetHeight);
    const finalCtx = finalCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!finalCtx) { if (ownedCanvas) releaseCanvas(ownedCanvas); throw new Error('สร้าง Canvas ปลายทางไม่สำเร็จ'); }
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    if (autoEdit) finalCtx.filter = buildAutoCanvasFilter(autoEdit);
    finalCtx.drawImage(currentSource, 0, 0, currentWidth, currentHeight, 0, 0, targetWidth, targetHeight);
    if (autoEdit) finalCtx.filter = 'none';
    if (ownedCanvas) releaseCanvas(ownedCanvas);
    return finalCanvas;
  }

  function releaseCanvas(canvas) {
    try { canvas.width = 1; canvas.height = 1; } catch (_) {}
  }

  async function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (!blob || !blob.size) reject(new Error('Encode JPEG ไม่สำเร็จ'));
          else resolve(blob);
        }, 'image/jpeg', quality);
      } catch (error) {
        reject(new Error(`Encode JPEG ไม่สำเร็จ: ${error.message || error}`));
      }
    });
  }

  async function encodeForFileLimit(canvas, limitBytes, metadataBytes, minQuality) {
    const maxQuality = 0.98;
    const highBlob = await canvasToJpegBlob(canvas, maxQuality);
    if (highBlob.size + metadataBytes <= limitBytes) return { blob: highBlob, quality: maxQuality };

    const lowBlob = await canvasToJpegBlob(canvas, minQuality);
    if (lowBlob.size + metadataBytes > limitBytes) {
      throw new Error(`ไม่สามารถทำให้ต่ำกว่า File Limit โดยคง Quality ขั้นต่ำ Q${Math.round(minQuality * 100)} ได้ กรุณาลด Long Edge หรือเพิ่ม File Limit`);
    }

    let low = minQuality;
    let high = maxQuality;
    let bestBlob = lowBlob;
    let bestQuality = minQuality;
    for (let i = 0; i < 9; i++) {
      const mid = (low + high) / 2;
      const blob = await canvasToJpegBlob(canvas, mid);
      if (blob.size + metadataBytes <= limitBytes) {
        bestBlob = blob;
        bestQuality = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    return { blob: bestBlob, quality: bestQuality };
  }

  async function prepareExifSegment(file, changes, width, height) {
    let prefixSize = Math.min(file.size, SCAN_BYTES_FIRST);
    let buffer = await file.slice(0, prefixSize).arrayBuffer();
    let parsed = core.inspect(buffer);
    if (!parsed.hasExif && file.size > prefixSize) {
      prefixSize = Math.min(file.size, SCAN_BYTES_FALLBACK);
      buffer = await file.slice(0, prefixSize).arrayBuffer();
      parsed = core.inspect(buffer);
    }
    if (!parsed.hasExif) return null;

    let patchedBuffer = buffer;
    if (Object.keys(changes).length) patchedBuffer = core.patchAscii(patchedBuffer, changes).buffer;
    if (typeof core.patchNumeric === 'function') {
      patchedBuffer = core.patchNumeric(patchedBuffer, { orientation: 1, pixelXDimension: width, pixelYDimension: height }).buffer;
    }
    return extractExifSegment(patchedBuffer);
  }

  function extractExifSegment(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const view = new DataView(arrayBuffer);
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xff) { pos++; continue; }
      const marker = bytes[pos + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      const len = view.getUint16(pos + 2, false);
      if (len < 2) break;
      const end = pos + 2 + len;
      if (end > bytes.length) break;
      const data = pos + 4;
      if (marker === 0xe1 && data + 6 <= end && bytes[data] === 0x45 && bytes[data + 1] === 0x78 && bytes[data + 2] === 0x69 && bytes[data + 3] === 0x66 && bytes[data + 4] === 0 && bytes[data + 5] === 0) {
        return bytes.slice(pos, end);
      }
      pos = end;
    }
    return null;
  }

  async function insertExifSegment(jpegBlob, exifSegment) {
    if (!exifSegment?.byteLength) return jpegBlob;
    const buffer = await jpegBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG หลัง Resize ไม่ถูกต้อง');

    let insertAt = 2;
    while (insertAt + 4 <= bytes.length && bytes[insertAt] === 0xff && bytes[insertAt + 1] === 0xe0) {
      const len = (bytes[insertAt + 2] << 8) | bytes[insertAt + 3];
      if (len < 2 || insertAt + 2 + len > bytes.length) break;
      insertAt += 2 + len;
    }
    return new Blob([bytes.slice(0, insertAt), exifSegment, bytes.slice(insertAt)], { type: 'image/jpeg' });
  }

  async function createSafeExportDirectory(parentHandle) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const base = `KEITA_EXPORT_${stamp}`;
    for (let n = 0; n < 100; n++) {
      const name = n === 0 ? base : `${base}_${n}`;
      try {
        await parentHandle.getDirectoryHandle(name, { create: false });
        continue;
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      const handle = await parentHandle.getDirectoryHandle(name, { create: true });
      return { handle, name };
    }
    throw new Error('ไม่สามารถสร้างชื่อโฟลเดอร์ Export ที่ไม่ซ้ำได้');
  }

  async function writeBlobToFolder(dirHandle, filename, blob) {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
  }

  function findDuplicates(values) {
    const seen = new Set();
    const dup = new Set();
    for (const value of values) {
      if (seen.has(value)) dup.add(value);
      else seen.add(value);
    }
    return [...dup];
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unit]}`;
  }

  function showResult(text, ok) {
    if (!text) {
      els.resultBox.classList.add('hidden');
      return;
    }
    els.resultBox.classList.remove('hidden');
    els.resultBox.style.background = ok ? '#edf8f2' : '#fff2f0';
    els.resultBox.style.borderColor = ok ? '#c8e8d7' : '#efc7c2';
    els.resultBox.style.color = ok ? '#22583c' : '#842c24';
    els.resultBox.textContent = text;
  }

  function safeInt(value) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : 0; }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function yieldToBrowser() { return new Promise((resolve) => setTimeout(resolve, 0)); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }

  init();
})();
