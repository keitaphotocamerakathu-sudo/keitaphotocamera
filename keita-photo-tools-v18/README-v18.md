# KEITA PHOTO TOOLS v18.0

## HL-Safe Auto Tune
- Auto Fine Tune remains conservative and subject-weighted.
- During Highlight selection, every PASS frame is compared before vs after Auto Tune.
- The guard checks highlight clipping, dynamic-range flattening, lifted black point, oversaturation, rim/backlight loss, and excessive night brightening.
- If Auto Tune lowers HL visual quality, tune strength is reduced to 65%, 45%, 25%, or 0% for that photo.
- The safer per-photo settings are saved and used by Export.
- Auto/Highlight text shows when HL-Safe adjusted a photo.

## Local Vision Learning — Advisory / Reference Only
- Teach KEITA saves a compact 64-value visual embedding with each newly taught photo.
- Existing local lessons are backfilled with a visual embedding when the matching source photo is shown again in Teach KEITA.
- The learned model reports KEEP/REJECT and HL reference probability, confidence, nearest similarity, and visual/rule matching.
- The learned model does **not** change Production PASS / REVIEW / REJECT.
- The learned model does **not** add/subtract Highlight score, force Portfolio eligibility, or auto-select/reject HL.
- Exact previously taught files are still Reference Only and never override Production.
- Production decisions remain controlled by the confirmed culling/highlight rules and primary models.
- Master AI carries the advisory embeddings so User Edition can display the same reference knowledge after a Master profile is published.
- For large albums, a 64×64 browser-local image representation is used and cached per file; no paid API or cloud inference is required.
- Older Master examples without vision data remain compatible and fall back to structured reference features.

## Master AI
- User Edition refreshes the latest Master profile before Smart Culling and before Highlight selection.
- A root `/keita-master-profile.json` baseline is included so the endpoint always exists.
- An empty baseline never replaces a non-empty cached Master.
- Teach KEITA can build/download a populated `keita-master-profile.json`; publishing that file at repository root makes it the shared Master for User Edition.

## License v18
- License key length: 20 characters with uppercase, lowercase, numbers, and special characters.
- Trial / monthly / yearly / custom expiry / lifetime plans are supported.
- First successful activation permanently binds the key to that device.
- A bound key cannot be reset and reused on another device; moving device requires a new key.
- Admin can Revoke a license.
- User Edition checks online license state on open and before Smart Culling / Highlight / Export.
- Cloudflare Worker + D1 remains the backend; Worker URL and secrets must be deployed outside GitHub before live activation works.

## v18 completion notes
- User / Admin / Teach / Startup Test pages compile with no missing direct DOM IDs.
- Stable root links point to `keita-photo-tools-v18`.
- Source files contain no v17.13 UI label in the v18 License Manager or Worker health version.
- Current production blocker is external deployment/configuration of the Cloudflare Worker/D1 URL; GitHub cannot supply that account-specific URL or secrets.


## Production Hardening 18.4 — Build 20260920.4

The production runtime is hardened for very large JPEG albums and long-running jobs.

- Duplicate source filenames are detected case-insensitively. When Rename is off, duplicate names receive a deterministic source-key suffix instead of overwriting each other.
- Preflight checks the final output-name plan again and blocks Export if any collision still remains.
- Album identity uses a whole-album rolling fingerprint rather than only count/first/last files.
- Resume storage uses IndexedDB v4 with separate `file_meta` and versioned `file_states` stores. EXIF metadata survives processing-setting changes without being rewritten with Culling/Auto/HL state.
- Export writes `KEITA_EXPORT_MANIFEST.json` containing album fingerprint, processing configuration signature, source key, output name, output size, mode and completion time.
- A resumed export compares the Manifest with real files on disk. Files committed before a crash but not yet checkpointed into the Manifest are recovered into it.
- A Manifest whose album or processing configuration differs from the current job is rejected for direct resume, preventing old Auto/Resize/Watermark output from being silently reused.
- Export failures are written to `KEITA_ERRORS.csv`; **Retry Failed Only** retries the affected source files while preserving already completed outputs.
- Culling, Auto Fine Tune and Highlight all use per-photo watchdogs. Culling timeout falls back to REVIEW; analysis timeouts recover the AI model state and continue safely.
- Highlight advanced candidates are stratified across the entire album timeline instead of being filled from the beginning of the album.
- The application shows the visible build number in the header/footer.
- **Production Check** validates secure context, File System Access, IndexedDB v4, Canvas, WebGL, ImageBitmap, browser storage, JPEG decoding, filename collisions, album fingerprint and export-folder write permission.
- **Stress Test 50,000** simulates 50,000 state/output records, uniqueness checks and stratified candidate selection without needing 50,000 real JPEG files.
- Large-album previews remain bounded: table max 100 rows, lazy thumbnails, virtualized Highlight Grid, decode-time downsampling and bounded Export concurrency.

### Release verification rule
Before a production build is considered ready, Owner and User runtime pages must both pass JavaScript syntax checks, duplicate-DOM-ID checks, required-element checks, and core-function parity for filename generation, fingerprinting, resume, Culling, Auto, Highlight, Manifest/Export, Production Check and Stress Test.

A simulated 50,000-record stress test is a regression guard, not a substitute for a real large JPEG workload. Final field validation should still use a representative real event album on the target Chrome/Mac hardware.
