import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const LINE_CHANNEL_ID = mustEnv("LINE_CHANNEL_ID");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function mustEnv(name: string) {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
    ["sign"],
  );
}

async function signPayload(payloadPart: string) {
  const key = await signingKey();

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart),
  );

  return base64Url(new Uint8Array(signature));
}

async function verifyLineIdToken(idToken: string) {
  const form = new URLSearchParams();
  form.set("id_token", idToken);
  form.set("client_id", LINE_CHANNEL_ID);

  const response = await fetch(
    "https://api.line.me/oauth2/v2.1/verify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.sub) {
    throw new Error(
      "LINE login หมดอายุหรือไม่ถูกต้อง กรุณาเปิดผ่าน LINE ใหม่",
    );
  }

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(
      { success: false, error: "Method not allowed" },
      405,
    );
  }

  try {
    const body = await req.json().catch(() => ({}));

    const orderId = clean(body.order_id);
    const orderItemId = clean(body.order_item_id);
    const lineIdToken = clean(body.line_id_token);

    if (!orderId || !orderItemId || !lineIdToken) {
      return json(
        {
          success: false,
          error:
            "Missing order_id, order_item_id or line_id_token",
        },
        400,
      );
    }

    const lineProfile = await verifyLineIdToken(lineIdToken);
    const lineUserId = clean(lineProfile.sub);

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
      .select("id,line_user_id,status,paid_at,event_id")
      .eq("id", orderId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
      return json(
        { success: false, error: "Order not found" },
        404,
      );
    }

    const status = clean(order.status).toLowerCase();

    if (!["approved", "paid"].includes(status) || !order.paid_at) {
      return json(
        {
          success: false,
          error: "Order is not paid/approved",
        },
        403,
      );
    }

    const { data: item, error: itemError } = await supabase
      .from("order_items")
      .select("id,order_id,photo_id,filename")
      .eq("id", orderItemId)
      .eq("order_id", orderId)
      .maybeSingle();

    if (itemError) throw itemError;

    if (!item || !item.photo_id) {
      return json(
        { success: false, error: "Order item not found" },
        404,
      );
    }

    const payload = {
      o: orderId,
      i: orderItemId,
    };

    const payloadPart = base64Url(
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const signaturePart = await signPayload(payloadPart);
    const token = `${payloadPart}.${signaturePart}`;

    const downloadUrl =
      `${SUPABASE_URL}/functions/v1/secure-download?token=${encodeURIComponent(token)}`;

    return json({
      success: true,
      url: downloadUrl,
      permanent: true,
    });
  } catch (error) {
    console.error("create-secure-download-link error:", error);

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
