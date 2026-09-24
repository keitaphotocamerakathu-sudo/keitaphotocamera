import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

const R2_WORKER_URL =
  String(Deno.env.get("R2_WORKER_URL") || "").trim() ||
  "https://keita-r2-upload.keitaphotocamera.workers.dev";

const R2_PUBLIC_BASE_URL =
  "https://pub-897300534774433b18d20c62be9f282.r2.dev";

// This is the same KEITA PHOTO CAMERA transparent logo already stored
// in this repository. The user supplied the same logo for free downloads.
const FREE_WATERMARK_URL =
  "https://keitaphotocamerakathu-sudo.github.io/keitaphotocamera/sony-video-review-pro-keita-watermark/keita-logo.png";
const FREE_WATERMARK_VERSION = "keita-logo-v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "range, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
};

let watermarkBytesPromise: Promise<Uint8Array> | null = null;

function mustEnv(name: string) {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isVideo(photo: any) {
  const mediaType = clean(photo?.media_type).toLowerCase();
  const mimeType = clean(photo?.mime_type).toLowerCase();
  const filename = clean(photo?.filename).toLowerCase();

  return (
    mediaType === "video" ||
    mimeType.startsWith("video/") ||
    /\.(mp4|mov|webm)$/i.test(filename) ||
    Boolean(
      photo?.video_path ||
      photo?.r2_video_key ||
      photo?.video_url ||
      photo?.r2_video_url
    )
  );
}

function extractR2Key(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";

  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "");
  }

  try {
    const url = new URL(raw);
    const worker = new URL(R2_WORKER_URL);

    if (url.origin === worker.origin) {
      return decodeURIComponent(
        url.pathname
          .replace(/^\/file\//, "")
          .replace(/^\/download\//, "")
          .replace(/^\/+/, "")
      );
    }

    const publicBase = new URL(R2_PUBLIC_BASE_URL);
    if (url.origin === publicBase.origin) {
      return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    }
  } catch {
    return "";
  }

  return "";
}

function resolveOriginalKey(photo: any) {
  const candidates = isVideo(photo)
    ? [
        photo?.video_path,
        photo?.r2_video_key,
        photo?.r2_original_key,
        photo?.r2_key,
        photo?.original_path,
        photo?.video_url,
        photo?.r2_video_url,
      ]
    : [
        photo?.r2_original_key,
        photo?.original_path,
        photo?.r2_key,
      ];

  for (const candidate of candidates) {
    const key = extractR2Key(candidate);
    if (key) return key;
  }

  return "";
}

function safeFilename(value: unknown, fallback: string) {
  return (clean(value) || fallback)
    .replace(/[\r\n"]/g, "_")
    .slice(0, 180);
}

function errorResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function originalR2Url(key: string) {
  return `${R2_WORKER_URL.replace(/\/+$/, "")}/file/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

async function getWatermarkBytes() {
  if (!watermarkBytesPromise) {
    watermarkBytesPromise = (async () => {
      const response = await fetch(FREE_WATERMARK_URL, {
        redirect: "follow",
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Unable to load KEITA watermark (${response.status})`,
        );
      }

      return new Uint8Array(await response.arrayBuffer());
    })().catch((error) => {
      watermarkBytesPromise = null;
      throw error;
    });
  }

  return await watermarkBytesPromise;
}

async function createWatermarkedPhoto(
  sourceBytes: Uint8Array,
  sourceContentType: string,
  filename: string,
) {
  const image = await Image.decode(sourceBytes);
  const watermark = await Image.decode(await getWatermarkBytes());

  // Keep the logo visible but unobtrusive in the lower-right corner.
  // Cap it so large Sony originals do not get an oversized watermark.
  const targetWidth = Math.max(
    220,
    Math.min(900, Math.round(image.width * 0.17)),
  );

  if (watermark.width !== targetWidth) {
    watermark.resize(targetWidth, Image.RESIZE_AUTO);
  }

  const shortEdge = Math.min(image.width, image.height);
  const padding = Math.max(28, Math.round(shortEdge * 0.018));

  const x = Math.max(0, image.width - watermark.width - padding);
  const y = Math.max(0, image.height - watermark.height - padding);

  image.composite(watermark, x, y);

  const lowerName = filename.toLowerCase();
  const sourceType = clean(sourceContentType).toLowerCase();

  if (sourceType.includes("png") || lowerName.endsWith(".png")) {
    return {
      bytes: new Uint8Array(await image.encode()),
      filename: lowerName.endsWith(".png")
        ? filename
        : filename.replace(/\.[^.]+$/, "") + ".png",
      mimeType: "image/png",
    };
  }

  return {
    bytes: new Uint8Array(await image.encodeJPEG(92)),
    filename: /\.jpe?g$/i.test(filename)
      ? filename
      : filename.replace(/\.[^.]+$/, "") + ".jpg",
    mimeType: "image/jpeg",
  };
}

async function cacheWatermarkedPhoto(
  supabase: any,
  photo: any,
  eventId: string,
  transformed: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
  },
) {
  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([transformed.bytes], { type: transformed.mimeType }),
      transformed.filename,
    );
    formData.append("event_id", eventId);
    formData.append("folder", "images/free-download");

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
        `Watermarked cache upload failed (${uploadResponse.status})`,
      );
    }

    const { error: updateError } = await supabase
      .from("photos")
      .update({
        free_download_path: uploadData.key,
        free_download_url: uploadData.publicUrl,
        free_download_watermark_version: FREE_WATERMARK_VERSION,
        free_download_generated_at: new Date().toISOString(),
      })
      .eq("id", photo.id)
      .eq("event_id", eventId);

    if (updateError) throw updateError;

    return {
      key: clean(uploadData.key),
      publicUrl: clean(uploadData.publicUrl),
    };
  } catch (error) {
    // Never block the customer's download because caching failed.
    console.warn("Unable to cache free watermarked file:", error);
    return null;
  }
}

function attachmentHeaders(filename: string) {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

async function streamR2Attachment(
  key: string,
  filename: string,
  range: string | null = null,
) {
  const upstreamHeaders = new Headers();
  if (range) upstreamHeaders.set("Range", range);

  const upstream = await fetch(originalR2Url(key), {
    method: "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  if (!upstream.ok && upstream.status !== 206) {
    return null;
  }

  const headers = attachmentHeaders(filename);

  for (const headerName of [
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }

  headers.set("X-KEITA-Free-Watermark", "1");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!["GET", "HEAD"].includes(req.method)) {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const url = new URL(req.url);
    const eventId = clean(url.searchParams.get("event_id"));
    const photoId = clean(url.searchParams.get("photo_id"));

    if (!validUuid(eventId) || !validUuid(photoId)) {
      return errorResponse("Invalid event_id or photo_id", 400);
    }

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

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,status,download_mode")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event) return errorResponse("Event not found", 404);

    if (clean(event.download_mode).toLowerCase() !== "free") {
      return errorResponse("This event is not a free-download event", 403);
    }

    const eventStatus = clean(event.status).toLowerCase();
    if (!["published", "active"].includes(eventStatus)) {
      return errorResponse("Event is not available for download", 403);
    }

    const { data: photo, error: photoError } = await supabase
      .from("photos")
      .select("*")
      .eq("id", photoId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (photoError) throw photoError;
    if (!photo) return errorResponse("Photo not found", 404);

    if (clean(photo.status).toLowerCase() !== "active") {
      return errorResponse("Photo is not available", 403);
    }

    const mediaVideo = isVideo(photo);
    const filename = safeFilename(
      photo.filename,
      mediaVideo ? "video.mp4" : "photo.jpg",
    );
    const eventPrefix = `events/${eventId}/`;

    // HEAD only verifies access. Avoid expensive image processing.
    if (req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: attachmentHeaders(filename),
      });
    }

    // Once a watermarked derivative has been generated, serve it directly.
    // This keeps repeat free downloads fast and avoids re-encoding each time.
    if (!mediaVideo) {
      const cachedKey = clean(photo.free_download_path);
      const cachedVersion = clean(photo.free_download_watermark_version);

      if (
        cachedKey &&
        cachedVersion === FREE_WATERMARK_VERSION &&
        cachedKey.startsWith(eventPrefix)
      ) {
        const cachedResponse = await streamR2Attachment(
          cachedKey,
          filename,
        );

        if (cachedResponse) {
          return cachedResponse;
        }

        console.warn(
          "Cached free download missing; regenerating:",
          cachedKey,
        );
      }
    }

    const key = resolveOriginalKey(photo);
    if (!key) {
      return errorResponse("Original file is unavailable", 404);
    }

    if (!key.startsWith(eventPrefix)) {
      console.error("Rejected original key outside event prefix:", key);
      return errorResponse("Original file is unavailable", 403);
    }

    if (mediaVideo) {
      const videoResponse = await streamR2Attachment(
        key,
        filename,
        req.headers.get("range"),
      );

      if (!videoResponse) {
        return errorResponse("Unable to retrieve file", 404);
      }

      return videoResponse;
    }

    const upstream = await fetch(originalR2Url(key), {
      method: "GET",
      redirect: "follow",
    });

    if (!upstream.ok) {
      console.error(
        "R2 free download failed:",
        upstream.status,
        key,
      );
      return errorResponse(
        "Unable to retrieve file",
        upstream.status === 404 ? 404 : 502,
      );
    }

    // Free image downloads always get the KEITA logo baked into the file.
    const sourceBytes = new Uint8Array(await upstream.arrayBuffer());
    const transformed = await createWatermarkedPhoto(
      sourceBytes,
      upstream.headers.get("content-type") || "image/jpeg",
      filename,
    );

    await cacheWatermarkedPhoto(
      supabase,
      photo,
      eventId,
      transformed,
    );

    const headers = attachmentHeaders(transformed.filename);
    headers.set("Content-Length", String(transformed.bytes.byteLength));
    headers.set("X-KEITA-Free-Watermark", "1");

    return new Response(transformed.bytes, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("free-download error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Download failed",
      500,
    );
  }
});
