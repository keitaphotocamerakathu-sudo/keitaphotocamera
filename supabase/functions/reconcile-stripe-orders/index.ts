import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

function mustEnv(name: string) {
  const value = clean(Deno.env.get(name));
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

async function verifyLineIdToken(idToken: string, channelId: string) {
  const form = new URLSearchParams();
  form.set("id_token", idToken);
  form.set("client_id", channelId);

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.sub) {
    throw new Error("LINE login หมดอายุหรือไม่ถูกต้อง กรุณาเปิดผ่าน LINE ใหม่");
  }

  return data;
}

async function retrieveCheckoutSession(secretKey: string, sessionId: string) {
  const url =
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || `Stripe session lookup failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const SUPABASE_URL = mustEnv("SUPABASE_URL");
    const SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const STRIPE_SECRET_KEY = mustEnv("STRIPE_SECRET_KEY");
    const LINE_CHANNEL_ID = mustEnv("LINE_CHANNEL_ID");

    const isTestKey =
      STRIPE_SECRET_KEY.startsWith("sk_test_") ||
      STRIPE_SECRET_KEY.startsWith("rk_test_");

    if (
      isTestKey &&
      clean(Deno.env.get("ALLOW_STRIPE_TEST_MODE")) !== "1"
    ) {
      return json({
        success: false,
        error: "Stripe ยังอยู่ในโหมดทดสอบ",
      }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const lineIdToken = clean(body.line_id_token);
    const requestedSessionId = clean(body.session_id);

    if (!lineIdToken) {
      return json({ success: false, error: "Missing LINE idToken" }, 401);
    }

    const lineProfile = await verifyLineIdToken(
      lineIdToken,
      LINE_CHANNEL_ID,
    );

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

    let query = supabase
      .from("orders")
      .select("*")
      .eq("line_user_id", lineUserId)
      .eq("payment_provider", "stripe")
      .in("status", ["pending_payment", "pending", "unpaid"])
      .not("stripe_checkout_session_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);

    if (requestedSessionId) {
      query = query.eq(
        "stripe_checkout_session_id",
        requestedSessionId,
      );
    }

    const { data: pendingOrders, error: ordersError } = await query;

    if (ordersError) {
      throw ordersError;
    }

    const results: any[] = [];

    for (const order of pendingOrders || []) {
      const sessionId = clean(order.stripe_checkout_session_id);
      if (!sessionId) continue;

      try {
        const session = await retrieveCheckoutSession(
          STRIPE_SECRET_KEY,
          sessionId,
        );

        const sessionOrderId =
          clean(session?.metadata?.order_id) ||
          clean(session?.client_reference_id);

        if (sessionOrderId !== String(order.id)) {
          results.push({
            order_id: order.id,
            session_id: sessionId,
            status: "skipped",
            reason: "Stripe session order mismatch",
          });
          continue;
        }

        const stripeCurrency = clean(session?.currency).toLowerCase();
        const orderCurrency = clean(order.currency || "thb").toLowerCase();

        const stripeAmount = Number(session?.amount_total || 0);
        const orderAmount = Math.round(Number(order.total_amount || 0) * 100);

        if (
          stripeCurrency !== orderCurrency ||
          stripeAmount !== orderAmount
        ) {
          results.push({
            order_id: order.id,
            session_id: sessionId,
            status: "skipped",
            reason: "Amount or currency mismatch",
          });
          continue;
        }

        if (clean(session?.payment_status).toLowerCase() !== "paid") {
          results.push({
            order_id: order.id,
            session_id: sessionId,
            status: "waiting",
            payment_status: clean(session?.payment_status),
          });
          continue;
        }

        const paymentIntent =
          typeof session?.payment_intent === "string"
            ? session.payment_intent
            : clean(session?.payment_intent?.id);

        const paidAt = new Date().toISOString();

        const { error: paymentError } = await supabase
          .from("payments")
          .update({
            status: "paid",
            stripe_payment_status: "paid",
            stripe_payment_intent_id: paymentIntent || null,
            paid_at: paidAt,
            failure_code: null,
            failure_message: null,
          })
          .eq("order_id", order.id)
          .neq("status", "paid");

        if (paymentError) {
          throw paymentError;
        }

        const { error: orderError } = await supabase
          .from("orders")
          .update({
            status: "approved",
            stripe_payment_intent_id: paymentIntent || null,
            paid_at: paidAt,
          })
          .eq("id", order.id)
          .in("status", ["pending_payment", "pending", "unpaid"]);

        if (orderError) {
          throw orderError;
        }

        let lineNotified = false;

        if (!order.line_notified_at || !order.telegram_notified_at) {
          const notifyRes = await fetch(
            `${SUPABASE_URL}/functions/v1/send-order-approved`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({ order_id: order.id }),
            },
          );

          lineNotified = notifyRes.ok;

          if (!notifyRes.ok) {
            console.warn(
              "send-order-approved failed:",
              notifyRes.status,
              await notifyRes.text(),
            );
          }
        } else {
          lineNotified = true;
        }

        results.push({
          order_id: order.id,
          order_no: order.order_no,
          session_id: sessionId,
          status: "approved",
          line_notified: lineNotified,
        });
      } catch (error) {
        console.error("RECONCILE ORDER ERROR:", order.id, error);

        results.push({
          order_id: order.id,
          session_id: sessionId,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return json({
      success: true,
      checked: results.length,
      results,
    });
  } catch (error) {
    console.error("RECONCILE STRIPE ORDERS ERROR:", error);

    return json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
