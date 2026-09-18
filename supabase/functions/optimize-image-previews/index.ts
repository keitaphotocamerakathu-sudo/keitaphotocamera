import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const R2_WORKER_URL =
  String(Deno.env.get("R2_WORKER_URL") || "").trim() ||
  "https://keita-r2-upload.keitaphotocamera.workers.dev";

const supabase = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

function mustEnv(name: string) {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function basenameNoExt(filename: string) {
  return filename.replace(/\.[^.]+$/, "") || "preview";
}

function sourceUrl(photo: any) {
  const direct =
    clean(photo.r2_original_key) ||
    clean(photo.original_path) ||
    clean(photo.r2_key);

  if (direct) {
    const key = direct.replace(/^\/+/, "");
    return `${R2_WORKER_URL.replace(/\/+$/, "")}/file/${key
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
  }

  return clean(photo.preview_url || photo.r2_preview_url);
}

async function optimizeOne(photo: any) {
  const src = sourceUrl(photo);
  if (!src) throw new Error("Missing source URL");

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Source fetch failed (${response.status})`);
  }

  const sourceBytes = new Uint8Array(await response.arrayBuffer());

  const image = await Image.decode(sourceBytes);

  const maxLongEdge = 1200;

  if (Math.max(image.width, image.height) > maxLongEdge) {
    if (image.width >= image.height) {
      image.resize(maxLongEdge, Image.RESIZE_AUTO);
    } else {
      image.resize(Image.RESIZE_AUTO, maxLongEdge);
    }
  }

  const encoded = await image.encodeJPEG(72);

  const fileName =
    `${basenameNoExt(clean(photo.filename) || "preview")}_preview.jpg`;

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([encoded], { type: "image/jpeg" }),
    fileName,
  );
  formData.append("event_id", clean(photo.event_id));
  formData.append("folder", "images/preview");

  const uploadResponse = await fetch(
    `${R2_WORKER_URL.replace(/\/+$/, "")}/upload`,
    {
      method: "POST",
      body: formData,
    },
  );

  const uploadData = await uploadResponse.json().catch(() => ({}));

  if (
    !uploadResponse.ok ||
    !uploadData?.success ||
    !uploadData?.key ||
    !uploadData?.publicUrl
  ) {
    throw new Error(
      uploadData?.message ||
      `Preview upload failed (${uploadResponse.status})`,
    );
  }

  const { error: updateError } = await supabase
    .from("photos")
    .update({
      preview_path: uploadData.key,
      watermark_path: uploadData.key,
      preview_url: uploadData.publicUrl,
      watermark_url: uploadData.publicUrl,
      r2_preview_url: uploadData.publicUrl,
      r2_watermark_url: uploadData.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", photo.id);

  if (updateError) throw updateError;

  return {
    photo_id: photo.id,
    filename: photo.filename,
    before_bytes: sourceBytes.byteLength,
    after_bytes: encoded.byteLength,
    width: image.width,
    height: image.height,
    preview_key: uploadData.key,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const presentedToken =
      clean(req.headers.get("x-job-token"));

    const { data: secretRow, error: secretError } =
      await supabase
        .from("internal_job_secrets")
        .select("token")
        .eq("job_name", "optimize-image-previews")
        .maybeSingle();

    if (secretError) throw secretError;

    const expectedToken = clean(secretRow?.token);

    if (!presentedToken || !expectedToken || presentedToken !== expectedToken) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const photoId = clean(body.photo_id);
    const requestedLimit = Number(body.limit || 5);
    const limit = Math.max(1, Math.min(10, Math.round(requestedLimit)));

    let query = supabase
      .from("photos")
      .select(
        "id,event_id,filename,media_type,original_path,preview_path,preview_url,r2_key,r2_original_key,r2_preview_url"
      )
      .eq("status", "active")
      .eq("media_type", "image")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (photoId) {
      query = query.eq("id", photoId);
    }

    const { data: rows, error: rowsError } = await query;
    if (rowsError) throw rowsError;

    const candidates = (rows || [])
      .filter((photo: any) => {
        if (photoId) return true;

        const previewPath = clean(photo.preview_path);
        const originalPath =
          clean(photo.r2_original_key) ||
          clean(photo.original_path) ||
          clean(photo.r2_key);

        return Boolean(
          originalPath &&
          (
            previewPath === originalPath ||
            !previewPath ||
            !previewPath.includes("/images/preview/")
          )
        );
      })
      .slice(0, limit);

    if (!candidates.length && !photoId) {
      const { error: stopError } = await supabase.rpc(
        "stop_preview_optimizer_job",
      );

      if (stopError) {
        console.warn("Unable to stop preview optimizer cron:", stopError);
      }

      return json({
        success: true,
        checked: 0,
        optimized: 0,
        failed: 0,
        completed: true,
        results: [],
      });
    }

    const results: any[] = [];

    for (const photo of candidates) {
      try {
        results.push({
          success: true,
          ...(await optimizeOne(photo)),
        });
      } catch (error) {
        results.push({
          success: false,
          photo_id: photo.id,
          filename: photo.filename,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }

    return json({
      success: true,
      checked: candidates.length,
      optimized: results.filter((x) => x.success).length,
      failed: results.filter((x) => !x.success).length,
      results,
    });
  } catch (error) {
    console.error("optimize-image-previews error:", error);

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500,
    );
  }
});
