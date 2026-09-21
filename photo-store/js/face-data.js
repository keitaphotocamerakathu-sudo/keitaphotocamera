/* Shared pagination for event media and face indexes. Keep a stable UUID cursor. */
(() => {
  'use strict';
  async function readAll(makeQuery, { signal, onPage } = {}) {
    const rows = []; let cursor = null;
    for (;;) {
      if (signal?.aborted) throw new DOMException('หยุดแล้ว', 'AbortError');
      let query = makeQuery().order('id', { ascending: true }).limit(500);
      if (cursor) query = query.gt('id', cursor);
      if (signal && query.abortSignal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) return rows;
      const next = data[data.length - 1].id;
      if (!next || next === cursor) throw new Error('อ่านรายการต่อไม่ได้ กรุณาโหลดใหม่');
      rows.push(...data); cursor = next; onPage?.(rows.length);
      // Continue until an empty page: projects may cap rows below our page size.
    }
  }
  window.KeitaFaceData = { readAll };
})();
