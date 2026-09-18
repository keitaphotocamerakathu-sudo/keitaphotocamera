# KEITA PHOTO TOOLS v18.0

## HL-Safe Auto Tune
- Auto Fine Tune remains conservative and subject-weighted.
- During Highlight selection, every PASS frame is compared before vs after Auto Tune.
- The guard checks highlight clipping, dynamic-range flattening, lifted black point, oversaturation, rim/backlight loss, and excessive night brightening.
- If Auto Tune lowers HL visual quality, tune strength is reduced to 65%, 45%, 25%, or 0% for that photo.
- The safer per-photo settings are saved and used by Export.
- Auto/Highlight text shows when HL-Safe adjusted a photo.

Existing Smart Culling, Master AI refresh, one-device License, Watermark, EXIF orientation and export flow are preserved.


## Local Vision Learning
- Teach KEITA now saves a compact 64-value visual embedding with each newly taught photo.
- Existing local lessons are automatically backfilled with a visual embedding when the matching source photo is shown again in Teach KEITA.
- Smart Culling combines technical/rule features with visual similarity when vision-trained examples exist.
- Highlight AI gives more visual weight to composition/light/style similarity than Sellable Culling.
- Master AI carries the visual embeddings, so User Edition receives the same learned visual knowledge after the Master is published.
- For large albums, a 64×64 browser-local image representation is used and cached per file; no paid API or cloud inference is required.
- Older Master examples without vision data remain compatible and fall back to the original structured feature model.
