# Face Search · FREE 2

YuNet detects faces and five landmarks; SFace embeds aligned faces locally in the browser. Model hashes and licenses are recorded in `licenses/FACE-MODELS.md`. Inference does not require a paid API.

## First use

Open `admin/process-faces.html`, select the event and start Sync Faces. The new engine needs its own index; previous face-api/FaceX vectors cannot be reused as SFace vectors. Previous indexes remain available for fallback searches. Keep “เฉพาะที่ยังไม่ Sync รุ่นนี้” checked to resume after stopping or reopening the page.

The sync completes and saves one whole media file at a time through `replace_keita_face_index`. A failure retains the previously saved index. The Stop button finishes the current file. Videos save only after every requested frame succeeds. Progress shows processing rate and estimated remaining time.

## Search

Upload a reference photo; select yourself when several faces are detected. Only the selected identity is queried. Result cards offer preview and add-to-cart actions; the additional-reference button is not shown. The loading dialog uses one plain search label throughout (Thai: “ค้นหาภาพ”), including model downloads. Different models are queried separately; fallback detectors must overlap the selected face.

The new cosine-distance threshold defaults to 0.45. Scores are not a calibrated probability or an accuracy guarantee. Event photos with strong profiles, very small faces or occlusion still need real-event evaluation. Public search opens directly in an external browser without forcing a LINE login. Inside LINE, or when an existing LINE session is present, it restores that session.

## Validation

Run `node --test tests/face-search.test.cjs` with Node 24+. Tests cover 1,327-row retrieval with a reduced server row cap, all result pages, vector-space separation, input validation, photo visibility, original-file redaction, video/photo deduplication, existing models, alignment, group identity selection, explicit refinement, cancellation and script syntax.

Production checks: free models load, public single-person and two-person fixtures detect successfully, and the live atomic RPC passes save, invalid-vector rollback and empty-index protection checks inside rolled-back transactions. No album was reindexed by these tests.

`supabase/reference/replace_keita_face_index.sql` records the already deployed invoker function. No access policies or grants were changed in this update.

## Clothing and appearance search

The same search screen also accepts a full-body photo in the event outfit. Select the intended person in a group photo. Face results appear first; extra outfit matches are labelled separately without an identity-confidence percentage. This feature compares visible appearance only.

In `admin/process-faces.html`, select “เสื้อผ้าและรูปร่าง (รูปภาพ)” to build the additional index. Existing face indexes are retained. Pending-only mode checks both the saved version and the actual person-row count, so missing person rows are queued again. Videos continue to use face search. Model provenance and the real-image validation report are in `licenses/PERSON-MODELS.md`.

New image uploads build both the SFace and appearance indexes automatically from the local source file. A partial failure retains any completed index and leaves the failed engine available to pending-only Sync. The previous upload routine remains in the source for rollback.
