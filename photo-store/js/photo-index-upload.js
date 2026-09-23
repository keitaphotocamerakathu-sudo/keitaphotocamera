/* Index newly uploaded photos using the same engines as search and manual Sync. */
(() => {
  'use strict';
  async function sync(db, photo, source) {
    let img, faceCount = 0, personCount = 0;
    const errors = [];
    try {
      img = await KeitaFaceFree.loadImage(source);
      // Each engine commits a complete file independently. A failed engine
      // remains pending for Sync; it must not discard the other saved index.
      try {
        const scan = await KeitaFaceFree.analyze(img, {deep: true});
        faceCount = await KeitaFaceFree.saveIndex(db, photo, scan);
      } catch (error) {
        errors.push('ใบหน้า: ' + (error.message || String(error)));
      }
      try {
        const scan = await KeitaPerson.analyze(img, {deep: true});
        personCount = await KeitaPerson.saveIndex(db, photo, scan);
      } catch (error) {
        errors.push('เสื้อผ้าและรูปร่าง: ' + (error.message || String(error)));
      }
    } catch (error) {
      errors.push(error.message || String(error));
    } finally {
      if (img) img.src = '';
    }
    return {success: errors.length === 0, faceCount, personCount, error: errors.join(' · ')};
  }
  window.KeitaPhotoIndex = {sync};
})();
