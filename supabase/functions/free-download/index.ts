import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

const R2_WORKER_URL =
  String(Deno.env.get("R2_WORKER_URL") || "").trim() ||
  "https://keita-r2-upload.keitaphotocamera.workers.dev";

const R2_PUBLIC_BASE_URL =
  "https://pub-897300534774433b18d20c62be9f282.r2.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "range, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
};

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

    const key = resolveOriginalKey(photo);
    if (!key) {
      return errorResponse("Original file is unavailable", 404);
    }

    const eventPrefix = `events/${eventId}/`;
    if (!key.startsWith(eventPrefix)) {
      console.error("Rejected original key outside event prefix:", key);
      return errorResponse("Original file is unavailable", 403);
    }

    const upstreamUrl =
      `${R2_WORKER_URL.replace(/\/+$/, "")}/file/${key
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}`;

    const upstreamHeaders = new Headers();
    const range = req.headers.get("range");
    if (range) upstreamHeaders.set("Range", range);

    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      console.error("R2 free download failed:", upstream.status, upstreamUrl);
      return errorResponse(
        "Unable to retrieve file",
        upstream.status === 404 ? 404 : 502,
      );
    }

    const mediaVideo = isVideo(photo);
    const filename = safeFilename(
      photo.filename,
      mediaVideo ? "video.mp4" : "photo.jpg",
    );

    const headers = new Headers(corsHeaders);

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

    // Force a real file download. Keeping image/jpeg lets some mobile
    // browsers / LINE IAB render the image instead of saving it.
    headers.set("Content-Type", "application/octet-stream");
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(
      req.method === "HEAD" ? null : upstream.body,
      {
        status: upstream.status,
        headers,
      },
    );
  } catch (error) {
    console.error("free-download error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Download failed",
      500,
    );
  }
});
