import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@18.5.0";

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = mustEnv("STRIPE_SECRET_KEY");

const timeoutMinutes = Math.max(
  30,
  Math.min(
    1440,
    Math.round(
      Number(Deno.env.get("ORDER_PAYMENT_TIMEOUT_MINUTES") || 30),
    ),
  ),
);

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

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

function getOrderId(session: Stripe.Checkout.Session) {
  return String(
    session.metadata?.order_id ||
    session.client_reference_id ||
    "",
  ).trim();
}

async function callSendOrderApproved(orderId: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/send-order-approved`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ order_id: orderId }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `send-order-approved failed (${response.status})`,
    );
  }
}

async function markPaid(
  order: any,
  session: Stripe.Checkout.Session,
) {
  const sessionOrderId = getOrderId(session);

  if (sessionOrderId !== String(order.id)) {
    throw new Error("Stripe session order mismatch");
  }

  const stripeCurrency =
    String(session.currency || "").toLowerCase();

  const orderCurrency =
    String(order.currency || "thb").toLowerCase();

  const stripeAmount =
    Number(session.amount_total || 0);

  const orderAmount =
    Math.round(Number(order.total_amount || 0) * 100);

  if (
    stripeCurrency !== orderCurrency ||
    stripeAmount !== orderAmount
  ) {
    throw new Error("Stripe amount or currency mismatch");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  const paidAt =
    order.paid_at || new Date().toISOString();

  const { error: paymentError } = await supabase
    .from("payments")
    .update({
      status: "paid",
      stripe_payment_status: "paid",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: paidAt,
      failure_code: null,
      failure_message: null,
    })
    .eq("order_id", order.id)
    .eq("provider", "stripe");

  if (paymentError) throw paymentError;

  const { error: orderError } = await supabase
    .from("orders")
    .update({
      status: "approved",
      stripe_payment_intent_id: paymentIntentId,
      paid_at: paidAt,
    })
    .eq("id", order.id);

  if (orderError) throw orderError;

  if (!order.line_notified_at) {
    await callSendOrderApproved(String(order.id));
  }
}

async function deleteUnpaid(order: any) {
  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", order.id)
    .is("paid_at", null)
    .in("status", ["pending_payment", "pending", "unpaid"]);

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(
      { success: false, error: "Method not allowed" },
      405,
    );
  }

  try {
    const cutoff = new Date(
      Date.now() - timeoutMinutes * 60 * 1000,
    ).toISOString();

    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("payment_provider", "stripe")
      .is("paid_at", null)
      .in("status", ["pending_payment", "pending", "unpaid"])
      .not("stripe_checkout_session_id", "is", null)
      .lte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) throw error;

    const results: any[] = [];

    for (const order of orders || []) {
      const sessionId =
        String(order.stripe_checkout_session_id || "").trim();

      try {
        let session =
          await stripe.checkout.sessions.retrieve(
            sessionId,
            { expand: ["payment_intent"] },
          );

        if (session.payment_status === "paid") {
          await markPaid(order, session);

          results.push({
            order_id: order.id,
            status: "approved",
          });

          continue;
        }

        if (session.status === "open") {
          session =
            await stripe.checkout.sessions.expire(sessionId);
        }

        // Only hard-delete after Stripe confirms the Checkout Session
        // is expired and still unpaid.
        if (
          session.status === "expired" &&
          session.payment_status !== "paid"
        ) {
          await deleteUnpaid(order);

          results.push({
            order_id: order.id,
            status: "deleted",
          });

          continue;
        }

        results.push({
          order_id: order.id,
          status: "kept",
          stripe_status: session.status,
          payment_status: session.payment_status,
        });
      } catch (err) {
        console.error(
          "cleanup order error:",
          order.id,
          err,
        );

        results.push({
          order_id: order.id,
          status: "error",
          error:
            err instanceof Error
              ? err.message
              : String(err),
        });
      }
    }

    return json({
      success: true,
      timeout_minutes: timeoutMinutes,
      checked: results.length,
      deleted:
        results.filter((x) => x.status === "deleted").length,
      approved:
        results.filter((x) => x.status === "approved").length,
      results,
    });
  } catch (err) {
    console.error("cleanup-unpaid-orders error:", err);

    return json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : String(err),
      },
      500,
    );
  }
});
