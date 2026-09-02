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
  };

  const els = {
    fileInput: $('fileInput'), folderInput: $('folderInput'), clearBtn: $('clearBtn'),
    fileCount: $('fileCount'), totalSize: $('totalSize'), exifCount: $('exifCount'), detectedTimezone: $('detectedTimezone'),
    cameraCard: $('cameraCard'), cameraModel: $('cameraModel'), imageDimensions: $('imageDimensions'), firstExifDate: $('firstExifDate'), firstTimezone: $('firstTimezone'),
    scanProgressWrap: $('scanProgressWrap'), scanProgressBar: $('scanProgressBar'), scanProgressText: $('scanProgressText'),
    renameEnabled: $('renameEnabled'), renameControls: $('renameControls'), keepOriginal: $('keepOriginal'), fixedText: $('fixedText'),
    photographerCode: $('photographerCode'), separator: $('separator'), startNumber: $('startNumber'), digits: $('digits'),
    renameBefore: $('renameBefore'), renameAfter: $('renameAfter'),
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
    els.resizeControls.classList.toggle('disabled-area', !els.resizeEnabled.checked);
    els.dateMainControls.classList.toggle('disabled-area', !els.dateFixEnabled.checked);
    els.timezoneControls.classList.toggle('disabled-area', !els.timezoneFixEnabled.checked);

    const mode = getDateMode();
    els.setDateMode.classList.toggle('hidden', mode !== 'setDate');
    els.setDateTimeMode.classList.toggle('hidden', mode !== 'setDateTime');
    els.offsetMode.classList.toggle('hidden', mode !== 'offset');

    const custom = els.targetTimezone.value === 'custom';
    els.customTimezoneWrap.classList.toggle('hidden', !custom);
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
      .map((file, index) => ({ file, index, meta: null, scanError: null, exportError: null, outputInfo: null }));
    state.firstValidDateMs = null;
    state.outputHandle = null;
    els.folderStatus.textContent = 'ยังไม่ได้เลือกโฟลเดอร์ · ระบบจะสร้าง KEITA_EXPORT_วันที่_เวลา ภายในโฟลเดอร์ที่เลือก';
    showResult('', true);

    renderStats();
    updatePreview();
    await scanMetadata();
    initializeDateInputsFromFirstPhoto();
    renderStats();
    updatePreview();
  }

  function clearFiles() {
    if (state.scanning) return;
    state.items = [];
    state.outputHandle = null;
    state.firstValidDateMs = null;
    els.fileInput.value = '';
    els.folderInput.value = '';
    els.folderStatus.textContent = 'ยังไม่ได้เลือกโฟลเดอร์ · ระบบจะสร้าง KEITA_EXPORT_วันที่_เวลา ภายในโฟลเดอร์ที่เลือก';
    renderStats();
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
    if (sameDims && sizeFits) return `${dims.width}×${dims.height} · เก็บ JPEG เดิม`;
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
      : 'ปิด Resize · จะไม่ Re-encode JPEG เพราะส่วนนี้';
  }

  function updatePreview() {
    updateRenameExample();
    updateResizeExample();
    if (!state.items.length) {
      els.previewBody.innerHTML = '<tr><td colspan="8" class="empty">เลือกรูปเพื่อดู Preview</td></tr>';
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
    const anyOperation = els.renameEnabled.checked || els.resizeEnabled.checked || els.dateFixEnabled.checked || els.timezoneFixEnabled.checked;

    if (!hasFiles) return { level: 'warn', blocking: true, messages: ['ยังไม่ได้เลือกรูป'] };
    if (state.scanning) return { level: 'warn', blocking: true, messages: ['กำลังอ่าน EXIF กรุณารอสักครู่'] };
    if (!anyOperation) return { level: 'warn', blocking: true, messages: ['ยังไม่ได้เปิด Rename, Resize, Date Fix หรือ Time Zone Fix'] };

    const outputNames = state.items.map((item, i) => buildOutputName(item.file.name, i));
    const duplicates = findDuplicates(outputNames.map((n) => n.toLowerCase()));
    if (duplicates.length) {
      level = 'error';
      messages.push(`ชื่อไฟล์ใหม่ซ้ำกัน เช่น ${duplicates.slice(0, 3).join(', ')}`);
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
    els.exportBtn.disabled = validation.blocking || !hasOutput || state.scanning;
    if (els.testResizeBtn) els.testResizeBtn.disabled = validation.blocking || state.scanning || !state.items.length;
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
      if (els.resizeEnabled.checked) result = await resizeAndOptimizeJpeg(item, changes);
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
        if (els.resizeEnabled.checked) {
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
    if (els.resizeEnabled.checked) {
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
    const knownDims = getDisplayDimensions(item.meta);
    if (knownDims) {
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
          info: { width: knownDims.width, height: knownDims.height, size: blob.size, quality: 1, reencoded: false, resized: false },
        };
      }
    }

    if (typeof createImageBitmap !== 'function') throw new Error('เบราว์เซอร์นี้ไม่รองรับการ Resize แบบที่ระบบใช้ แนะนำ Chrome/Edge รุ่นปัจจุบัน');

    const decoded = await decodeJpegForResize(item.file);
    const source = decoded.source;
    try {
      const target = calcTargetDimensions(decoded.width, decoded.height, settings.longEdge, settings.noUpscale);
      if (!target) throw new Error('อ่านขนาดภาพไม่ได้');

      // ใช้ HTMLCanvasElement เป็นหลักเพื่อความเข้ากันได้สูงสุดกับ Chrome/Edge บน macOS
      // และลดภาพแบบหลายขั้นเมื่อต้องย่อลงมาก เพื่อรักษารายละเอียดให้ดีกว่าการย่อครั้งเดียว
      const canvas = await highQualityResize(source, decoded.width, decoded.height, target.width, target.height);

      const exifSegment = await prepareExifSegment(item.file, changes, target.width, target.height);
      const metadataBytes = exifSegment ? exifSegment.byteLength : 0;
      const encoded = await encodeForFileLimit(canvas, settings.fileLimitBytes, metadataBytes, settings.minQuality);
      let outputBlob = encoded.blob;
      if (exifSegment) outputBlob = await insertExifSegment(outputBlob, exifSegment);

      releaseCanvas(canvas);
      if (outputBlob.size > settings.fileLimitBytes) {
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

  async function highQualityResize(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
      const canvas = createWorkCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!ctx) throw new Error('สร้าง Canvas ไม่สำเร็จ');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
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
    finalCtx.drawImage(currentSource, 0, 0, currentWidth, currentHeight, 0, 0, targetWidth, targetHeight);
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
