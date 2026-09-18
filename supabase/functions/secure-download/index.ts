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

function decodeBase64Url(value: string) {
  const normalized =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function signingKey() {
  const material = new TextEncoder().encode(
    `keita-secure-download-v1:${SERVICE_ROLE_KEY}`,
  );

  const digest = await crypto.subtle.digest(
    "SHA-256",
    material,
  );

  return await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyToken(token: string) {
  const [payloadPart, signaturePart] = token.split(".");

  if (!payloadPart || !signaturePart) {
    throw new Error("Invalid download token");
  }

  const key = await signingKey();

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signaturePart),
    new TextEncoder().encode(payloadPart),
  );

  if (!valid) {
    throw new Error("Invalid download token");
  }

  const payloadText = new TextDecoder().decode(
    decodeBase64Url(payloadPart),
  );

  const payload = JSON.parse(payloadText);

  const orderId = clean(payload?.o);
  const itemId = clean(payload?.i);
  const expiresAt = Number(payload?.e || 0);

  if (!orderId || !itemId || !Number.isFinite(expiresAt)) {
    throw new Error("Invalid download token payload");
  }

  if (Math.floor(Date.now() / 1000) > expiresAt) {
    throw new Error("Download link expired");
  }

  return { orderId, itemId };
}

function isVideo(photo: any, item: any) {
  const mediaType =
    clean(photo?.media_type || item?.media_type).toLowerCase();

  const mimeType =
    clean(photo?.mime_type || item?.mime_type).toLowerCase();

  const filename =
    clean(photo?.filename || item?.filename).toLowerCase();

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
      const path = url.pathname
        .replace(/^\/file\//, "")
        .replace(/^\/download\//, "")
        .replace(/^\/+/, "");

      return decodeURIComponent(path);
    }

    const publicBase = new URL(R2_PUBLIC_BASE_URL);
    if (url.origin === publicBase.origin) {
      return decodeURIComponent(
        url.pathname.replace(/^\/+/, ""),
      );
    }
  } catch {
    return "";
  }

  return "";
}

function resolveOriginalKey(photo: any, item: any) {
  const video = isVideo(photo, item);

  const candidates = video
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
  const raw = clean(value) || fallback;

  return raw
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
    const token = clean(url.searchParams.get("token"));

    if (!token) {
      return errorResponse("Missing download token", 400);
    }

    const { orderId, itemId } = await verifyToken(token);

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

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,status,paid_at,event_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
      return errorResponse("Order not found", 404);
    }

    const status = clean(order.status).toLowerCase();

    if (!["approved", "paid"].includes(status) || !order.paid_at) {
      return errorResponse("Order is not paid/approved", 403);
    }

    // If the Event has been deleted, downloads must disappear as well.
    if (!order.event_id) {
      return errorResponse("Event no longer available", 410);
    }

    const { data: eventExists, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("id", order.event_id)
      .maybeSingle();

    if (eventError) throw eventError;

    if (!eventExists) {
      return errorResponse("Event no longer available", 410);
    }

    const { data: item, error: itemError } = await supabase
      .from("order_items")
      .select("id,order_id,photo_id,filename")
      .eq("id", itemId)
      .eq("order_id", orderId)
      .maybeSingle();

    if (itemError) throw itemError;

    if (!item || !item.photo_id) {
      return errorResponse("Order item not found", 404);
    }

    const { data: photo, error: photoError } = await supabase
      .from("photos")
      .select("*")
      .eq("id", item.photo_id)
      .maybeSingle();

    if (photoError) throw photoError;

    if (!photo) {
      return errorResponse("File not found", 404);
    }

    const key = resolveOriginalKey(photo, item);

    if (!key) {
      return errorResponse("Original file is unavailable", 404);
    }

    const upstreamUrl =
      `${R2_WORKER_URL.replace(/\/+$/, "")}/file/${key
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}`;

    const upstreamHeaders = new Headers();

    const range = req.headers.get("range");
    if (range) {
      upstreamHeaders.set("Range", range);
    }

    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      console.error(
        "R2 download failed:",
        upstream.status,
        upstreamUrl,
      );

      return errorResponse(
        "Unable to retrieve file",
        upstream.status === 404 ? 404 : 502,
      );
    }

    const mediaVideo = isVideo(photo, item);

    const filename = safeFilename(
      photo.filename || item.filename,
      mediaVideo ? "video.mp4" : "photo.jpg",
    );

    const headers = new Headers(corsHeaders);

    for (const headerName of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
    ]) {
      const value = upstream.headers.get(headerName);
      if (value) headers.set(headerName, value);
    }

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
    console.error("secure-download error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Download failed";

    const status =
      message === "Download link expired"
        ? 410
        : message.startsWith("Invalid download token")
          ? 403
          : 500;

    return errorResponse(message, status);
  }
});
