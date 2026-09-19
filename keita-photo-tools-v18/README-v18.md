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
