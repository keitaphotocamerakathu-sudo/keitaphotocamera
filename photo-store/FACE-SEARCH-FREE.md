# Face Search · FREE 2

YuNet detects faces and five landmarks; SFace embeds aligned faces locally in the browser. Model hashes and licenses are recorded in `licenses/FACE-MODELS.md`. Inference does not require a paid API.

## First use

Open `admin/process-faces.html`, select the event and start Sync Faces. The new engine needs its own index; previous face-api/FaceX vectors cannot be reused as SFace vectors. Previous indexes remain available for fallback searches. Keep “เฉพาะที่ยังไม่ Sync รุ่นนี้” checked to resume after stopping or reopening the page.

The sync completes and saves one whole media file at a time through `replace_keita_face_index`. A failure retains the previously saved index. The Stop button finishes the current file. Videos save only after every requested frame succeeds. Progress shows processing rate and estimated remaining time.

## Search

Upload a reference photo; select yourself when several faces are detected. Only the selected identity is queried. “ฉันอยู่ในภาพนี้ · ค้นหาเพิ่ม” lets the customer explicitly select another reference pose, up to six SFace references. Different models are queried separately; fallback detectors must overlap the selected face. Additional references are kept in memory for that search session.

The new cosine-distance threshold defaults to 0.45. Scores are not a calibrated probability or an accuracy guarantee. Event photos with strong profiles, very small faces or occlusion still need real-event evaluation. Customers should use the existing LINE entry point; a direct external browser may require a correctly configured LINE redirect URI.

## Validation

Run `node --test tests/face-search.test.cjs` with Node 24+. Tests cover 1,327-row retrieval with a reduced server row cap, all result pages, vector-space separation, input validation, photo visibility, original-file redaction, video/photo deduplication, existing models, alignment, group identity selection, explicit refinement, cancellation and script syntax.

Production checks: free models load, public single-person and two-person fixtures detect successfully, and the live atomic RPC passes save, invalid-vector rollback and empty-index protection checks inside rolled-back transactions. No album was reindexed by these tests.

`supabase/reference/replace_keita_face_index.sql` records the already deployed invoker function. No access policies or grants were changed in this update.
