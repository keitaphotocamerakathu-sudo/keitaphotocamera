import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * ค่าค้นหาแบบเข้ม
 * ยิ่งน้อย = ยิ่งแม่น / ยิ่งเจอยาก
 *
 * 0.35 - 0.38 = เข้มมาก
 * 0.39 - 0.42 = ยังเข้ม แต่ยืดหยุ่นขึ้น
 * 0.50+ = กว้าง มีโอกาสเจอคนอื่น
 */
const STRICT_DEFAULT_THRESHOLD = 0.38;
const STRICT_MAX_THRESHOLD = 0.40;

const NORMAL_DEFAULT_THRESHOLD = 0.45;
const NORMAL_MAX_THRESHOLD = 0.50;

const STRICT_DEFAULT_GAP_LIMIT = 0.045;
const STRICT_MAX_GAP_LIMIT = 0.06;

const NORMAL_DEFAULT_GAP_LIMIT = 0.08;
const NORMAL_MAX_GAP_LIMIT = 0.12;

const MAX_ALLOWED_RESULTS_STRICT = 30;
const MAX_ALLOWED_RESULTS_NORMAL = 80;

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function parseVector(raw: any): number[] {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : (raw?.descriptor ?? raw);
    return Array.isArray(value) && value.every(v => typeof v === 'number' && Number.isFinite(v)) ? value : [];
  } catch { return []; }
}

function isValidDescriptor(vector: number[], expectedDim = 128) {
  return (
    Array.isArray(vector) &&
    vector.length === expectedDim &&
    vector.every((v) => Number.isFinite(v))
  );
}

function vectorDistance(a: number[], b: number[], engine: string) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 999;

  if (engine === "sface-yunet-v1" || engine === "facex-v2" || engine === "facex-v3" || engine === "facex-v4" || engine === "facex-profile-v1" || engine === "facex-profile-v2") {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (!na || !nb) return 999;
    const cosine = dot / (Math.sqrt(na) * Math.sqrt(nb));
    return 1 - Math.max(-1, Math.min(1, cosine));
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * confidence นี้ใช้แสดงผลเท่านั้น
 * decision หลักใช้ distance + threshold
 */
function confidenceFromDistance(distance: number) {
  if (!Number.isFinite(distance)) return 0;
  if (distance >= 1) return 0;

  return Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));
}

function getMediaType(face: any, photo: any) {
  const faceMediaType = String(face?.media_type || "").toLowerCase();
  const photoMediaType = String(photo?.media_type || "").toLowerCase();
  const mimeType = String(photo?.mime_type || "").toLowerCase();
  const filename = String(
    photo?.filename ||
      photo?.file_name ||
      face?.filename ||
      ""
  ).toLowerCase();

  if (faceMediaType === "video" || photoMediaType === "video") {
    return "video";
  }

  if (faceMediaType === "image" || photoMediaType === "image") {
    return "image";
  }

  if (
    mimeType.startsWith("video/") ||
    filename.endsWith(".mp4") ||
    filename.endsWith(".mov") ||
    filename.endsWith(".webm") ||
    photo?.video_url ||
    photo?.video_path ||
    photo?.video_preview_url ||
    photo?.video_preview_path
  ) {
    return "video";
  }

  return "image";
}

function cleanPhotoPayload(photo: any, mediaType: string) {
  if (!photo) return null;

  return {
    id: photo.id,
    event_id: photo.event_id,

    filename: photo.filename || photo.file_name || photo.name || null,
    file_name: photo.file_name || photo.filename || photo.name || null,

    price: photo.price ?? null,
    status: photo.status ?? null,

    media_type: mediaType,
    mime_type: photo.mime_type ?? null,
    file_size: photo.file_size ?? null,
    duration_seconds: photo.duration_seconds ?? null,

    preview_url: photo.preview_url ?? null,
    watermark_url: photo.watermark_url ?? null,
    r2_preview_url: photo.r2_preview_url ?? null,
    r2_watermark_url: photo.r2_watermark_url ?? null,

    // Never expose original media keys/URLs to the customer browser.
    // Purchased originals are served only through secure-download.
    preview_path: photo.preview_path ?? null,
    watermark_path: photo.watermark_path ?? null,

    video_preview_url: photo.video_preview_url ?? null,
    video_preview_path: photo.video_preview_path ?? null,
    r2_video_preview_url: photo.r2_video_preview_url ?? null,
    r2_video_preview_key: photo.r2_video_preview_key ?? null,

    thumbnail_url: photo.thumbnail_url ?? null,
    thumbnail_path: photo.thumbnail_path ?? null,
    r2_thumbnail_url: photo.r2_thumbnail_url ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error: "Method not allowed",
        },
        405
      );
    }

    const body = await req.json();

    const event_id = body.event_id;
    const engines = new Set(['sface-yunet-v1','facex-profile-v2','facex-profile-v1','facex-v4','facex-v3','facex-v2','face-api-v4-clean','face-api-v3']);
    const engine = body.engine || 'face-api-v3';
    if (!engines.has(engine)) return jsonResponse({success:false,error:'Unknown face engine'},400);
    const isSFace = engine === 'sface-yunet-v1';
    const expectedDim = (engine === "facex-v2" || engine === "facex-v3" || engine === "facex-v4" || engine === "facex-profile-v1" || engine === "facex-profile-v2") ? 512 : 128;

    const requestedDescriptors = Array.isArray(body.descriptors)
      ? body.descriptors
      : [body.descriptor];

    if (!requestedDescriptors.length || requestedDescriptors.length > 6) return jsonResponse({success:false,error:'Provide 1 to 6 descriptors of the same person'},400);
    const inputDescriptors = requestedDescriptors
      .map((value: unknown) => parseVector(value))
      .filter((value: number[]) => isValidDescriptor(value, expectedDim));

    const inputDescriptor =
      inputDescriptors[0] ||
      parseVector(body.descriptor);

    /**
     * strict เปิดเป็น default
     * ถ้าต้องการค้นกว้างจริง ๆ ค่อยส่ง strict:false
     */
    const strictMode = body.strict !== false;

    /**
     * Gap filtering is useful for single-best verification, but it hurts
     * event-photo retrieval when the uploaded query image itself exists in
     * the event: bestDistance can be ~0, causing valid side/profile shots to
     * be discarded even though they pass the absolute identity threshold.
     * Keep the old behaviour by default; callers may explicitly disable it.
     */
    const useGapFilter = !isSFace && body.use_gap !== false;

    const isFaceXV2 = engine === "facex-v2" || engine === "facex-v3" || engine === "facex-v4" || engine === "facex-profile-v1" || engine === "facex-profile-v2";
    const requestedThreshold = Number(
      body.threshold ??
        (isSFace ? 0.45 : isFaceXV2 ? 0.62 : (strictMode ? STRICT_DEFAULT_THRESHOLD : NORMAL_DEFAULT_THRESHOLD))
    );

    const threshold = isSFace ? clampNumber(requestedThreshold, 0.20, 0.55) : isFaceXV2
      ? clampNumber(requestedThreshold, 0.30, 0.72)
      : (strictMode
          ? clampNumber(requestedThreshold, 0.30, STRICT_MAX_THRESHOLD)
          : clampNumber(requestedThreshold, 0.30, NORMAL_MAX_THRESHOLD));

    const requestedGapLimit = Number(
      body.gap_limit ??
        (isFaceXV2 ? 0.14 : (strictMode ? STRICT_DEFAULT_GAP_LIMIT : NORMAL_DEFAULT_GAP_LIMIT))
    );

    const gapLimit = isFaceXV2
      ? clampNumber(requestedGapLimit, 0.03, 0.20)
      : (strictMode
          ? clampNumber(requestedGapLimit, 0.02, STRICT_MAX_GAP_LIMIT)
          : clampNumber(requestedGapLimit, 0.02, NORMAL_MAX_GAP_LIMIT));

    const requestedMaxResults = Number(body.max_results || 30);

    const maxResults = Math.floor(clampNumber(requestedMaxResults, 1, 300));
    const offset = Math.floor(clampNumber(Number(body.offset ?? 0), 0, 100000));
    if (typeof event_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event_id)) return jsonResponse({success:false,error:'Invalid event_id'},400);
    if (inputDescriptors.length !== requestedDescriptors.length || !inputDescriptors.every(v => isValidDescriptor(v, expectedDim) && v.some(x => x !== 0))) return jsonResponse({success:false,error:'Invalid face descriptor'},400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl) {
      throw new Error("Missing SUPABASE_URL");
    }

    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    /**
     * ใช้ faces(*), photos(*)
     * เพื่อให้รองรับ column ใหม่/เก่าได้ยืดหยุ่นกว่า select ราย column
     */
    // Read the entire event, including projects with a row cap below 500.
    const rawFaces: any[] = [];
    let cursor: string | null = null;
    for (;;) {
      let query = supabase.from('faces').select('*, photos (*)').eq('event_id', event_id).eq('engine', engine).order('id', {ascending:true}).limit(500);
      if (cursor) query = query.gt('id', cursor);
      const {data, error} = await query;
      if (error) throw error;
      if (!data?.length) break;
      const next = data[data.length-1].id;
      if (!next || next === cursor) throw new Error('Face index pagination failed');
      rawFaces.push(...data); cursor = next;
    }

    const checked = rawFaces
      .map((face: any) => {
        const storedDescriptor = parseVector(face.descriptor);
        const descriptorValid = isValidDescriptor(storedDescriptor, expectedDim);

        const distance = descriptorValid
          ? Math.min(
              ...inputDescriptors.map((queryDescriptor: number[]) =>
                vectorDistance(queryDescriptor, storedDescriptor, engine)
              )
            )
          : 999;

        const confidence = confidenceFromDistance(distance);
        const photo = face.photos || null;
        const mediaType = getMediaType(face, photo);

        return {
          face_id: face.id,
          event_id: face.event_id,
          photo_id: face.photo_id,

          distance,
          confidence,
          descriptor_length: storedDescriptor.length,
          descriptor_valid: descriptorValid,

          media_type: mediaType,

          face_index:
            face.face_index === undefined || face.face_index === null
              ? null
              : Number(face.face_index),

          frame_index:
            face.frame_index === undefined || face.frame_index === null
              ? null
              : Number(face.frame_index),

          video_time_seconds:
            face.video_time_seconds === undefined ||
            face.video_time_seconds === null
              ? null
              : Number(face.video_time_seconds),

          face_image_url: face.image_url || null,
          face_filename: face.filename || null,

          face_box: face.face_box ?? null,
          photo_status: photo?.status || null,
          photo: cleanPhotoPayload(photo, mediaType),
        };
      })
      .filter((item) => item.descriptor_valid)
      .filter((item) => item.distance < 999)
      .filter((item) => item.photo_id && item.photo && item.photo.event_id === event_id)
      .filter((item) => {
        /**
         * ถ้า photos.status มีค่า และไม่ใช่ active ให้ตัดออก
         * ถ้าไม่มี status ให้ปล่อยผ่านเพื่อรองรับ schema เก่า
         */
        if (!item.photo_status) return true;
        return String(item.photo_status).toLowerCase() === "active";
      })
      .sort((a, b) => a.distance - b.distance);

    /**
     * กรอง match ที่เกิน threshold ออกก่อน
     * ถ้าเป็นคนที่ไม่มีใน Event ส่วนนี้ควรเหลือ 0
     */
    const withinThreshold = checked.filter((item) => {
      return item.distance <= threshold;
    });

    /**
     * เลือกผลที่ดีที่สุดต่อ 1 photo_id
     * วิดีโอหนึ่งไฟล์อาจมีหลาย frame จึงต้อง dedupe
     */
    const bestByPhotoId = new Map<string, any>();

    for (const item of withinThreshold) {
      const key = String(item.photo_id);
      const old = bestByPhotoId.get(key);

      if (!old || item.distance < old.distance) {
        bestByPhotoId.set(key, item);
      }
    }

    let results = Array.from(bestByPhotoId.values()).sort(
      (a, b) => a.distance - b.distance
    );

    let decision = "NO_MATCH";
    let decisionReason = "ไม่พบใบหน้าที่ตรงตามค่าความแม่นยำ";
    let bestDistance: number | null = null;

    if (results.length > 0) {
      bestDistance = results[0].distance;

      /**
       * ตัดผลที่ห่างจากอันดับ 1 เกิน gapLimit
       * ป้องกันลากคนอื่นเข้ามาเยอะ
       */
      if (useGapFilter) {
        results = results.filter((item) => {
          return item.distance <= bestDistance! + gapLimit;
        });
      }

      /**
       * โหมดเข้ม:
       * ถ้าอันดับแรกยังห่างเกิน threshold ถือว่าไม่พบ
       * ถึงตรงนี้จริง ๆ จะผ่าน threshold มาแล้ว แต่กันพลาดอีกชั้น
       */
      if (strictMode && bestDistance > threshold) {
        results = [];
        decision = "NO_MATCH";
        decisionReason = "best distance สูงกว่า threshold";
      } else {
        decision = "MATCH_FOUND";
        decisionReason = "พบใบหน้าที่ใกล้เคียงในช่วง strict threshold";
      }
    }

    const matchedTotal = results.length;
    results = results.slice(offset, offset + maxResults);

    /**
     * nearest เอาไว้ debug เท่านั้น
     * ต่อให้ nearest มีคนใกล้ ๆ แต่ถ้าไม่ผ่าน threshold จะไม่อยู่ใน results
     */
    const nearest = checked.slice(0, 10).map((item) => ({
      face_id: item.face_id,
      photo_id: item.photo_id,
      filename:
        item.photo?.filename ||
        item.face_filename ||
        null,
      media_type: item.media_type,
      distance: roundNumber(item.distance),
      confidence: item.confidence,
      descriptor_length: item.descriptor_length,
      frame_index: item.frame_index,
      video_time_seconds:
        item.video_time_seconds === null
          ? null
          : roundNumber(Number(item.video_time_seconds), 2),
      passed_threshold: item.distance <= threshold,
    }));

    const cleanResults = results.map((item) => ({
      face_id: item.face_id,
      photo_id: item.photo_id,

      distance: roundNumber(item.distance),
      confidence: item.confidence,

      media_type: item.media_type,

      face_box: item.face_box,
      engine,
      face_index: item.face_index,
      frame_index: item.frame_index,
      video_time_seconds:
        item.video_time_seconds === null
          ? null
          : roundNumber(Number(item.video_time_seconds), 2),

      face_image_url: item.face_image_url,
      face_filename: item.face_filename,

      photo: item.photo,
    }));

    return jsonResponse({
      success: true,

      event_id,
      engine,

      strict: strictMode,
      decision,
      decision_reason: decisionReason,

      threshold,
      gap_limit: gapLimit,
      max_results: maxResults,

      best_distance:
        bestDistance === null ? null : roundNumber(bestDistance),

      input_descriptor_length: inputDescriptor.length,
      input_descriptor_count: inputDescriptors.length,

      total_faces: rawFaces.length,
      checked_faces: checked.length,
      within_threshold_faces: withinThreshold.length,

      matched_count: cleanResults.length,
      matched_total: matchedTotal,
      offset,
      has_more: offset + cleanResults.length < matchedTotal,
      next_offset: offset + cleanResults.length,

      nearest,
      results: cleanResults,
    });
  } catch (err) {
    return jsonResponse(
      {
        success: false,
        error: err?.message || String(err),
      },
      500
    );
  }
});
