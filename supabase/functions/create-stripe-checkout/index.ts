import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRICING_VERSION = "photo_video_v1";
const CURRENCY = "thb";

// Server-authoritative pricing.
// You can override these values in Supabase Edge Function Secrets.
const PHOTO_SINGLE_PRICE = envNumber("PHOTO_SINGLE_PRICE", 60);
const PHOTO_PACK_10_PRICE = envNumber("PHOTO_PACK_10_PRICE", 250);
const PHOTO_PACK_20_PRICE = envNumber("PHOTO_PACK_20_PRICE", 500);
const VIDEO_SINGLE_PRICE = envNumber("VIDEO_SINGLE_PRICE", 199);
const VIDEO_ADDON_PRICE = envNumber("VIDEO_ADDON_PRICE", 149);
const ORDER_PAYMENT_TIMEOUT_MINUTES = Math.max(
  30,
  Math.min(1440, Math.round(envNumber("ORDER_PAYMENT_TIMEOUT_MINUTES", 30))),
);

type JsonRecord = Record<string, unknown>;

type PhotoRow = {
  id: string;
  event_id: string | null;
  filename?: string | null;
  file_name?: string | null;
  media_type?: string | null;
  mime_type?: string | null;
  status?: string | null;

  preview_url?: string | null;
  watermark_url?: string | null;
  watermarked_url?: string | null;
  r2_preview_url?: string | null;
  r2_watermark_url?: string | null;
  thumbnail_url?: string | null;

  video_url?: string | null;
  video_preview_url?: string | null;
  video_path?: string | null;
  video_preview_path?: string | null;
  r2_video_url?: string | null;
  r2_video_preview_url?: string | null;
};

type EventRow = {
  id: string;
  title?: string | null;
  name?: string | null;
  stripe_connected_account_id?: string | null;
  stripe_platform_fee_percent?: number | string | null;
  price?: number | string | null;
  photo_price?: number | string | null;
  [key: string]: unknown;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed" },
      405,
    );
  }

  let createdOrderId: string | null = null;

  try {
    // -------------------------------------------------------
    // 1) Required server secrets
    // -------------------------------------------------------
    const SUPABASE_URL = mustEnv("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const STRIPE_SECRET_KEY = mustEnv("STRIPE_SECRET_KEY");
    const SITE_URL = stripTrailingSlash(
      cleanString(Deno.env.get("SITE_URL")) ||
      "https://keitaphotocamerakathu-sudo.github.io"
    );

    const STORE_BASE_URL = stripTrailingSlash(
      cleanString(Deno.env.get("STORE_BASE_URL")) ||
      `${SITE_URL}/keitaphotocamera/photo-store`
    );
    const LINE_CHANNEL_ID = mustEnv("LINE_CHANNEL_ID");

    const isStripeSecretKey =
      STRIPE_SECRET_KEY.startsWith("sk_test_") ||
      STRIPE_SECRET_KEY.startsWith("sk_live_");

    const isStripeRestrictedKey =
      STRIPE_SECRET_KEY.startsWith("rk_test_") ||
      STRIPE_SECRET_KEY.startsWith("rk_live_");

    if (!isStripeSecretKey && !isStripeRestrictedKey) {
      throw new HttpError(
        500,
        "STRIPE_SECRET_KEY รูปแบบไม่ถูกต้อง ต้องเป็น sk_live_... หรือ rk_live_... และในช่อง Value ห้ามใส่ชื่อ STRIPE_SECRET_KEY= นำหน้า",
      );
    }

    const isStripeTestMode =
      STRIPE_SECRET_KEY.startsWith("sk_test_") ||
      STRIPE_SECRET_KEY.startsWith("rk_test_");

    // Production safety: refuse to create real checkout flow with a test key.
    // Set ALLOW_STRIPE_TEST_MODE=1 only when intentionally running sandbox tests.
    if (
      isStripeTestMode &&
      String(Deno.env.get("ALLOW_STRIPE_TEST_MODE") || "").trim() !== "1"
    ) {
      throw new HttpError(
        503,
        "Stripe ยังอยู่ในโหมดทดสอบ กรุณาตั้งค่า STRIPE_SECRET_KEY เป็น Live key ก่อนรับชำระเงินจริง",
      );
    }

    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    // -------------------------------------------------------
    // 2) Read and validate browser payload
    // Browser is NOT trusted for amount, pricing or userId.
    // -------------------------------------------------------
    let body: JsonRecord;

    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "JSON request ไม่ถูกต้อง");
    }

    const eventId = cleanString(body.event_id);
    const language = normalizeLanguage(body.language);
    const lineIdToken = cleanString(body.line_id_token);

    const photoIds = Array.from(
      new Set(
        (Array.isArray(body.photo_ids) ? body.photo_ids : [])
          .map((value) => cleanString(value))
          .filter(Boolean),
      ),
    );

    if (!eventId) {
      throw new HttpError(400, "Missing event_id");
    }

    if (!lineIdToken) {
      throw new HttpError(401, "Missing LINE idToken");
    }

    if (!photoIds.length) {
      throw new HttpError(400, "ไม่มีสินค้าในตะกร้า");
    }

    if (photoIds.length > 200) {
      throw new HttpError(400, "รายการในตะกร้ามากเกินไป");
    }

    // -------------------------------------------------------
    // 3) Verify LINE idToken server-side
    // Never trust LINE userId received from JavaScript.
    // -------------------------------------------------------
    const lineProfile = await verifyLineIdToken(
      lineIdToken,
      LINE_CHANNEL_ID,
    );

    const lineUserId = cleanString(lineProfile.sub);

    if (!lineUserId) {
      throw new HttpError(401, "ไม่พบ LINE user id");
    }

    const lineDisplayName =
      cleanString(lineProfile.name) || "LINE User";

    const linePictureUrl =
      cleanString(lineProfile.picture) || null;

    // -------------------------------------------------------
    // 4) Load authoritative Event
    // -------------------------------------------------------
    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError || !eventData) {
      console.error("EVENT LOAD ERROR:", eventError);
      throw new HttpError(404, "ไม่พบ Event");
    }

    const event = eventData as EventRow;

    // Event price is authoritative for normal photo pricing.
    const eventPhotoPrice = positiveNumber(
      event.price ?? event.photo_price,
      PHOTO_SINGLE_PRICE,
    );

    // -------------------------------------------------------
    // 5) Load authoritative photo/video records
    // -------------------------------------------------------
    const { data: photosData, error: photosError } = await supabase
      .from("photos")
      .select("*")
      .in("id", photoIds);

    if (photosError) {
      console.error("PHOTOS LOAD ERROR:", photosError);
      throw new HttpError(500, "โหลดรายการสินค้าไม่สำเร็จ");
    }

    const photos = (photosData || []) as PhotoRow[];

    if (photos.length !== photoIds.length) {
      throw new HttpError(
        400,
        "มีภาพหรือ VDO บางรายการที่ไม่พบในระบบ",
      );
    }

    // Preserve the cart order sent by the browser.
    const photoMap = new Map(
      photos.map((photo) => [String(photo.id), photo]),
    );

    const orderedPhotos = photoIds.map((id) => photoMap.get(id)!);

    for (const photo of orderedPhotos) {
      if (String(photo.event_id || "") !== eventId) {
        throw new HttpError(
          400,
          "มีรายการที่ไม่ได้อยู่ใน Event นี้",
        );
      }

      if (
        photo.status &&
        String(photo.status).toLowerCase() !== "active"
      ) {
        throw new HttpError(
          400,
          `รายการ ${photo.filename || photo.id} ไม่พร้อมจำหน่าย`,
        );
      }
    }

    // -------------------------------------------------------
    // 6) Calculate ALL prices on the server
    // -------------------------------------------------------
    const pricing = calculatePricing(
      orderedPhotos,
      eventPhotoPrice,
    );

    if (pricing.totalBaht <= 0) {
      throw new HttpError(400, "ยอดชำระไม่ถูกต้อง");
    }

    const totalSatang = bahtToSatang(pricing.totalBaht);

    // -------------------------------------------------------
    // 7) Optional Stripe Connect destination
    //
    // If events.stripe_connected_account_id is empty:
    //   payment is collected by the platform account.
    //
    // If it contains acct_...:
    //   create a destination charge.
    // -------------------------------------------------------
    const connectedAccountId =
      normalizeStripeAccountId(event.stripe_connected_account_id);

    const platformFeePercent = clampPercent(
      event.stripe_platform_fee_percent ??
        Deno.env.get("STRIPE_PLATFORM_FEE_PERCENT") ??
        0,
    );

    const applicationFeeSatang =
      connectedAccountId && platformFeePercent > 0
        ? Math.min(
            totalSatang,
            Math.round(totalSatang * platformFeePercent / 100),
          )
        : 0;

    // -------------------------------------------------------
    // 8) Create order in Supabase
    // -------------------------------------------------------
    const orderNo =
      `ORD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const orderPayload = {
      order_no: orderNo,
      line_user_id: lineUserId,
      line_display_name: lineDisplayName,
      line_picture_url: linePictureUrl,
      event_id: eventId,
      total_amount: pricing.totalBaht,
      status: "pending_payment",
      language,
      payment_provider: "stripe",
      currency: CURRENCY,
    };

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert(orderPayload)
      .select("*")
      .single();

    if (orderError || !order) {
      console.error("ORDER CREATE ERROR:", orderError);
      throw new HttpError(
        500,
        orderError?.message || "สร้าง Order ไม่สำเร็จ",
      );
    }

    createdOrderId = String(order.id);

    // -------------------------------------------------------
    // 9) Create order_items with server-calculated prices
    // -------------------------------------------------------
    const orderItems = buildOrderItems({
      orderId: createdOrderId,
      eventId,
      photos: orderedPhotos,
      imageUnitPrices: pricing.imageUnitPrices,
      videoUnitPrice: pricing.videoUnitPrice,
    });

    const itemTotal = round2(
      orderItems.reduce(
        (sum, item) => sum + Number(item.price || 0),
        0,
      ),
    );

    if (itemTotal !== round2(pricing.totalBaht)) {
      console.error("ITEM TOTAL MISMATCH:", {
        itemTotal,
        total: pricing.totalBaht,
        orderItems,
      });

      throw new HttpError(
        500,
        `ยอดสินค้าไม่ตรงกับยอดชำระ (${itemTotal} / ${pricing.totalBaht})`,
      );
    }

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItems);

    if (itemsError) {
      console.error("ORDER ITEMS ERROR:", itemsError);
      await safeCancelOrder(supabase, createdOrderId);
      throw new HttpError(
        500,
        itemsError.message || "สร้าง Order Items ไม่สำเร็จ",
      );
    }

    // -------------------------------------------------------
    // 10) Create pending payment record
    // -------------------------------------------------------
    const paymentPayload = {
      order_id: createdOrderId,
      amount: pricing.totalBaht,
      status: "pending",
      provider: "stripe",
      currency: CURRENCY,
      stripe_payment_status: "unpaid",
      metadata: {
        pricing_version: PRICING_VERSION,
        photo_single_price: eventPhotoPrice,
        image_count: pricing.imageCount,
        video_count: pricing.videoCount,
        normal_total: pricing.normalTotalBaht,
        saving: pricing.savingBaht,
        stripe_mode: isStripeTestMode ? "test" : "live",
        connect_destination: connectedAccountId,
        platform_fee_percent: platformFeePercent,
      },
    };

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert(paymentPayload)
      .select("*")
      .single();

    if (paymentError) {
      console.error("PAYMENT CREATE ERROR:", paymentError);
      await safeCancelOrder(supabase, createdOrderId);
      throw new HttpError(
        500,
        paymentError.message || "สร้าง Payment ไม่สำเร็จ",
      );
    }

    // -------------------------------------------------------
    // 11) Create Stripe Checkout Session
    // The browser receives only session.url.
    // -------------------------------------------------------
    // Always return to the actual GitHub Pages storefront path.
    // STORE_BASE_URL can be overridden later if the storefront moves.
    const successUrl =
      `${STORE_BASE_URL}/order.html?stripe=success&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrlBase =
      `${STORE_BASE_URL}/checkout.html`;

    const cancelUrl =
      `${cancelUrlBase}${cancelUrlBase.includes("?") ? "&" : "?"}` +
      `event=${encodeURIComponent(eventId)}&stripe_cancelled=1`;

    const eventName =
      cleanString(event.title) ||
      cleanString(event.name) ||
      "Photo Event";

    const checkoutSession = await createStripeCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      orderId: createdOrderId,
      orderNo,
      eventId,
      eventName,
      lineUserId,
      language,
      totalSatang,
      imageCount: pricing.imageCount,
      videoCount: pricing.videoCount,
      connectedAccountId,
      applicationFeeSatang,
      successUrl,
      cancelUrl,
    });

    // -------------------------------------------------------
    // 12) Store Stripe IDs back in database.
    // This is bookkeeping only; webhook remains authoritative.
    // -------------------------------------------------------
    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({
        stripe_checkout_session_id: checkoutSession.id,
      })
      .eq("id", createdOrderId);

    if (updateOrderError) {
      console.warn(
        "ORDER STRIPE ID UPDATE WARNING:",
        updateOrderError,
      );
    }

    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        stripe_checkout_session_id: checkoutSession.id,
        stripe_payment_status:
          cleanString(checkoutSession.payment_status) || "unpaid",
      })
      .eq("id", payment.id);

    if (updatePaymentError) {
      console.warn(
        "PAYMENT STRIPE ID UPDATE WARNING:",
        updatePaymentError,
      );
    }

    // -------------------------------------------------------
    // 13) Return Checkout URL
    // Do NOT mark paid here.
    // Do NOT clear the cart here.
    // -------------------------------------------------------
    return jsonResponse({
      success: true,
      test_mode: isStripeTestMode,
      order_id: createdOrderId,
      order_no: orderNo,
      session_id: checkoutSession.id,
      checkout_url: checkoutSession.url,
      currency: CURRENCY,
      amount: pricing.totalBaht,
      pricing: {
        version: PRICING_VERSION,
        photo_single_price: eventPhotoPrice,
        image_count: pricing.imageCount,
        video_count: pricing.videoCount,
        image_total: pricing.imageTotalBaht,
        video_total: pricing.videoTotalBaht,
        normal_total: pricing.normalTotalBaht,
        saving: pricing.savingBaht,
      },
      connect: {
        enabled: Boolean(connectedAccountId),
        destination: connectedAccountId,
        platform_fee_percent: platformFeePercent,
        application_fee_amount_satang: applicationFeeSatang,
      },
    });
  } catch (error) {
    console.error("CREATE STRIPE CHECKOUT ERROR:", error);

    const status =
      error instanceof HttpError ? error.status : 500;

    const message =
      error instanceof Error
        ? error.message
        : "ไม่สามารถสร้าง Stripe Checkout ได้";

    return jsonResponse(
      {
        success: false,
        error: message,
        order_id: createdOrderId,
      },
      status,
    );
  }
});

// ===========================================================
// Stripe Checkout
// ===========================================================

async function createStripeCheckoutSession(input: {
  secretKey: string;
  orderId: string;
  orderNo: string;
  eventId: string;
  eventName: string;
  lineUserId: string;
  language: string;
  totalSatang: number;
  imageCount: number;
  videoCount: number;
  connectedAccountId: string | null;
  applicationFeeSatang: number;
  successUrl: string;
  cancelUrl: string;
}) {
  const params = new URLSearchParams();

  params.set("mode", "payment");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.orderId);

  // Unpaid Checkout Sessions expire automatically. Stripe requires
  // expires_at to be between 30 minutes and 24 hours from creation.
  params.set(
    "expires_at",
    String(
      Math.floor(Date.now() / 1000) +
        (ORDER_PAYMENT_TIMEOUT_MINUTES * 60),
    ),
  );

  // Let Stripe decide which eligible payment methods to show.
  // No payment_method_types are hard-coded here.

  params.set(
    "line_items[0][price_data][currency]",
    CURRENCY,
  );
  params.set(
    "line_items[0][price_data][product_data][name]",
    `${input.eventName} — ${input.orderNo}`,
  );
  params.set(
    "line_items[0][price_data][product_data][description]",
    buildStripeDescription(input.imageCount, input.videoCount),
  );
  params.set(
    "line_items[0][price_data][unit_amount]",
    String(input.totalSatang),
  );
  params.set("line_items[0][quantity]", "1");

  // Checkout Session metadata
  params.set("metadata[order_id]", input.orderId);
  params.set("metadata[order_no]", input.orderNo);
  params.set("metadata[event_id]", input.eventId);
  params.set("metadata[line_user_id]", input.lineUserId);
  params.set("metadata[pricing_version]", PRICING_VERSION);

  // PaymentIntent metadata
  params.set(
    "payment_intent_data[metadata][order_id]",
    input.orderId,
  );
  params.set(
    "payment_intent_data[metadata][order_no]",
    input.orderNo,
  );
  params.set(
    "payment_intent_data[metadata][event_id]",
    input.eventId,
  );
  params.set(
    "payment_intent_data[metadata][line_user_id]",
    input.lineUserId,
  );
  params.set(
    "payment_intent_data[metadata][pricing_version]",
    PRICING_VERSION,
  );

  // Stripe Connect destination charge.
  // Do not use on_behalf_of here.
  if (input.connectedAccountId) {
    params.set(
      "payment_intent_data[transfer_data][destination]",
      input.connectedAccountId,
    );

    if (input.applicationFeeSatang > 0) {
      params.set(
        "payment_intent_data[application_fee_amount]",
        String(input.applicationFeeSatang),
      );
    }
  }

  const response = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `checkout-order-${input.orderId}`,
      },
      body: params.toString(),
    },
  );

  const raw = await response.text();

  let data: Record<string, unknown>;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    console.error("STRIPE SESSION ERROR:", data);

    const stripeError = data?.error as
      | { message?: string; code?: string }
      | undefined;

    throw new HttpError(
      502,
      stripeError?.message ||
        `Stripe Checkout error (${response.status})`,
    );
  }

  const sessionId = cleanString(data.id);
  const sessionUrl = cleanString(data.url);

  if (!sessionId || !sessionUrl) {
    throw new HttpError(
      502,
      "Stripe ไม่ส่ง Checkout Session URL กลับมา",
    );
  }

  return {
    id: sessionId,
    url: sessionUrl,
    payment_status: data.payment_status,
  };
}

// ===========================================================
// LINE verification
// ===========================================================

async function verifyLineIdToken(
  idToken: string,
  channelId: string,
) {
  const form = new URLSearchParams();

  form.set("id_token", idToken);
  form.set("client_id", channelId);

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

  const raw = await response.text();

  let data: Record<string, unknown>;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    console.error("LINE TOKEN VERIFY ERROR:", data);

    throw new HttpError(
      401,
      "LINE login หมดอายุหรือไม่ถูกต้อง กรุณาเปิดผ่าน LINE ใหม่",
    );
  }

  return data;
}

// ===========================================================
// Pricing
// ===========================================================

function calculatePricing(photos: PhotoRow[], imageSinglePrice: number) {
  const imageItems = photos.filter(
    (photo) => getMediaType(photo) === "image",
  );

  const videoItems = photos.filter(
    (photo) => getMediaType(photo) === "video",
  );

  const imageCount = imageItems.length;
  const videoCount = videoItems.length;

  const imageUnitPrices: number[] = [];

  let imageTotalBaht = 0;

  if (imageCount >= 20) {
    for (let i = 0; i < imageCount; i++) {
      imageUnitPrices.push(
        i < 20
          ? round2(PHOTO_PACK_20_PRICE / 20)
          : imageSinglePrice,
      );
    }

    imageTotalBaht =
      PHOTO_PACK_20_PRICE +
      ((imageCount - 20) * imageSinglePrice);
  } else if (imageCount >= 10) {
    for (let i = 0; i < imageCount; i++) {
      imageUnitPrices.push(
        i < 10
          ? round2(PHOTO_PACK_10_PRICE / 10)
          : imageSinglePrice,
      );
    }

    imageTotalBaht =
      PHOTO_PACK_10_PRICE +
      ((imageCount - 10) * imageSinglePrice);
  } else {
    for (let i = 0; i < imageCount; i++) {
      imageUnitPrices.push(imageSinglePrice);
    }

    imageTotalBaht =
      imageCount * imageSinglePrice;
  }

  const hasImagePackage = imageCount >= 10;

  const videoUnitPrice =
    hasImagePackage
      ? VIDEO_ADDON_PRICE
      : VIDEO_SINGLE_PRICE;

  const videoTotalBaht =
    videoCount * videoUnitPrice;

  const normalTotalBaht =
    (imageCount * imageSinglePrice) +
    (videoCount * VIDEO_SINGLE_PRICE);

  const totalBaht =
    round2(imageTotalBaht + videoTotalBaht);

  const savingBaht =
    round2(Math.max(0, normalTotalBaht - totalBaht));

  return {
    imageCount,
    videoCount,
    imageUnitPrices,

    imageTotalBaht: round2(imageTotalBaht),
    videoUnitPrice: round2(videoUnitPrice),
    videoTotalBaht: round2(videoTotalBaht),

    normalTotalBaht: round2(normalTotalBaht),
    totalBaht,
    savingBaht,
  };
}

function buildOrderItems(input: {
  orderId: string;
  eventId: string;
  photos: PhotoRow[];
  imageUnitPrices: number[];
  videoUnitPrice: number;
}) {
  let imageIndex = 0;

  return input.photos.map((photo) => {
    const isVideo = getMediaType(photo) === "video";

    const price = isVideo
      ? input.videoUnitPrice
      : input.imageUnitPrices[imageIndex++];

    return {
      order_id: input.orderId,
      photo_id: photo.id,
      event_id: photo.event_id || input.eventId,
      filename:
        photo.filename ||
        photo.file_name ||
        String(photo.id),
      photo_url: getSafePreviewUrl(photo),
      price: round2(price),
    };
  });
}

function getMediaType(photo: PhotoRow): "image" | "video" {
  const mediaType =
    String(photo.media_type || "").toLowerCase();

  const mimeType =
    String(photo.mime_type || "").toLowerCase();

  const filename =
    String(
      photo.filename ||
      photo.file_name ||
      "",
    ).toLowerCase();

  if (mediaType === "video") return "video";
  if (mediaType === "image") return "image";

  if (
    mimeType.startsWith("video/") ||
    filename.endsWith(".mp4") ||
    filename.endsWith(".mov") ||
    filename.endsWith(".webm") ||
    photo.video_url ||
    photo.video_preview_url ||
    photo.video_path ||
    photo.video_preview_path ||
    photo.r2_video_url ||
    photo.r2_video_preview_url
  ) {
    return "video";
  }

  return "image";
}

function getSafePreviewUrl(photo: PhotoRow) {
  return (
    cleanString(photo.thumbnail_url) ||
    cleanString(photo.preview_url) ||
    cleanString(photo.watermark_url) ||
    cleanString(photo.watermarked_url) ||
    cleanString(photo.r2_preview_url) ||
    cleanString(photo.r2_watermark_url) ||
    ""
  );
}

// ===========================================================
// Helpers
// ===========================================================

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(
  data: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function mustEnv(name: string) {
  const value = cleanString(Deno.env.get(name));

  if (!value) {
    throw new HttpError(
      500,
      `Missing Edge Function secret: ${name}`,
    );
  }

  return value;
}

function envNumber(
  name: string,
  fallback: number,
) {
  const raw = Deno.env.get(name);

  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() === ""
  ) {
    return fallback;
  }

  const value = Number(raw);

  return Number.isFinite(value)
    ? value
    : fallback;
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeLanguage(value: unknown) {
  const lang = cleanString(value).toLowerCase();

  if (["th", "en", "ru"].includes(lang)) {
    return lang;
  }

  return "th";
}

function normalizeStripeAccountId(
  value: unknown,
): string | null {
  const accountId = cleanString(value);

  return /^acct_[A-Za-z0-9]+$/.test(accountId)
    ? accountId
    : null;
}

function positiveNumber(
  value: unknown,
  fallback: number,
) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return number;
}

function clampPercent(value: unknown) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) return 0;

  return Math.max(0, Math.min(100, number));
}

function round2(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function bahtToSatang(value: number) {
  return Math.round(round2(value) * 100);
}

function buildStripeDescription(
  imageCount: number,
  videoCount: number,
) {
  const parts: string[] = [];

  if (imageCount > 0) {
    parts.push(`${imageCount} photo${imageCount === 1 ? "" : "s"}`);
  }

  if (videoCount > 0) {
    parts.push(`${videoCount} VDO`);
  }

  return parts.join(" + ") || "Digital media";
}

async function safeCancelOrder(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
) {
  try {
    await supabase
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId);
  } catch (error) {
    console.warn("SAFE CANCEL ORDER WARNING:", error);
  }
}
