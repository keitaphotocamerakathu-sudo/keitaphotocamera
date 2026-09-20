# KEITA PHOTO TOOLS v18 — Production Notes

Current production build: **18.5.1-20260920**  
UI badge: **Build 18.5.1 · 20260920.6**

## Production goal

KEITA PHOTO TOOLS v18 is designed for large local JPEG workflows, including albums with **10,000–50,000+ photos**.

Core rules:

- Original files are never overwritten.
- Processing is local in the browser.
- Large albums use bounded/incremental state instead of storing the whole workflow in one session record.
- Culling, Auto Tune and Highlight state are persisted per file in IndexedDB.
- Export recovery is disk-authoritative: existing output files + KEITA_EXPORT_MANIFEST.json are reconciled before continuing.
- Export errors are recorded in KEITA_ERRORS.csv and can be retried with **Retry Failed Only**.

## Before a large job

1. Use current Chrome/Edge over HTTPS.
2. Open the v18 page and confirm the badge is Build 18.5.0.
3. Click **ตรวจระบบก่อนเริ่มงาน**.
4. For a large event, also run **Stress Test 50,000**.
5. Use **เลือกโฟลเดอร์ + Resume** for the source when possible.
6. Choose an output drive with enough free space before Export.
7. Do not rename/move the source files during an active Resume session.

## Resume model

### Culling / Auto / Highlight

State is stored incrementally per file. v18.5 uses a **State Epoch fail-safe**:

- Changing settings that invalidate processed results creates a new epoch.
- If the browser is closed/reloaded while an epoch rewrite is incomplete, partial process state from that interrupted epoch is discarded on the next startup.
- Original files remain untouched.
- The UI explains that the affected processing step should be run again.

### Export

Every export session creates or uses:

- `01_ALL_PHOTOS`
- `02_HIGHLIGHT_WATERMARK`
- `03_HIGHLIGHT_CLEAN`
- `KEITA_EXPORT_MANIFEST.json`
- `KEITA_ERRORS.csv` when errors occur

For a stopped/crashed export:

1. Reopen the same source album.
2. Click **เปิดงาน Export เดิม / Resume Existing Export**.
3. Select the existing `KEITA_EXPORT_...` folder.
4. KEITA scans the real files on disk and reconciles them with the manifest.
5. Only missing/incomplete outputs are processed again.

## v18.5 large-album changes

- Manifest writes are serialized so multiple export workers cannot write the manifest concurrently.
- Large Album Mode reduces manifest rewrite frequency.
- Large Album Mode increases export checkpoint size to reduce I/O overhead while keeping disk-based recovery.
- Resume summary now reads incremental IndexedDB state instead of the old embedded `fileStates` array.
- State Epoch pending writes are detected and cleaned safely after an interrupted reload.
- Watermark pointer gestures have additional mouseup/mousemove/pagehide fallbacks to prevent a resize/move gesture from remaining stuck after the button is released.
- Internal v18 navigation uses a build query string to reduce stale-page caching.

## Watermark safety

If a drag/resize gesture is interrupted:

- Pointer Up / Pointer Cancel ends the gesture.
- Mouse Up is a fallback.
- Mouse movement with no mouse button pressed force-ends the gesture.
- Browser blur, page hide and tab visibility changes force-end the gesture.
- Escape cancels the active gesture and restores its starting position/size.

## Large Album expectations

The built-in 50,000 test validates data-structure and workflow pressure, but it is not a substitute for a real full-resolution event workload. Before relying on a new build for paid work, test a representative event folder on the same Mac/browser/output drive you will use in production.

## Cache / stale page

The v18 internal navigation uses `?v=20260920.6`. If a browser tab was already open before deployment, refresh the tab before starting a new event job and verify the visible Build badge.
