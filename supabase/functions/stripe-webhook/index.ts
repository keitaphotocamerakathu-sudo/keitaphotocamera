import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@18.5.0";

const STRIPE_SECRET_KEY = mustEnv("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = mustEnv("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(
      { received: false, error: "Method not allowed" },
      405,
    );
  }

  // Stripe requires the exact raw request body.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return jsonResponse(
      { received: false, error: "Missing Stripe-Signature" },
      400,
    );
  }

  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error("Webhook signature verification failed:", error);

    return jsonResponse(
      {
        received: false,
        error: "Invalid Stripe signature",
      },
      400,
    );
  }

  console.log("Stripe event:", event.id, event.type);

  try {
    // -------------------------------------------------------
    // 1. Idempotency: don't fully process the exact same
    // Stripe event more than once.
    // -------------------------------------------------------
    const { data: oldEvent, error: oldEventError } = await supabase
      .from("stripe_webhook_events")
      .select("event_id")
      .eq("event_id", event.id)
      .maybeSingle();

    if (oldEventError) {
      throw oldEventError;
    }

    if (oldEvent) {
      return jsonResponse({
        received: true,
        duplicate: true,
        event_id: event.id,
      });
    }

    let orderId: string | null = null;

    // -------------------------------------------------------
    // 2. Handle only the Checkout lifecycle we need.
    // -------------------------------------------------------
    switch (event.type) {
      case "checkout.session.completed": {
        const eventSession =
          event.data.object as Stripe.Checkout.Session;

        const session = await retrieveCheckoutSession(
          eventSession.id,
        );

        orderId = getOrderId(session);

        // Card / instant methods can already be paid here.
        if (session.payment_status === "paid") {
          await fulfillPaidOrder(session);
        } else {
          await markPaymentProcessing(session);
        }

        break;
      }

      case "checkout.session.async_payment_succeeded": {
        const eventSession =
          event.data.object as Stripe.Checkout.Session;

        const session = await retrieveCheckoutSession(
          eventSession.id,
        );

        orderId = getOrderId(session);

        await fulfillPaidOrder(session);

        break;
      }

      case "checkout.session.async_payment_failed": {
        const eventSession =
          event.data.object as Stripe.Checkout.Session;

        const session = await retrieveCheckoutSession(
          eventSession.id,
        );

        orderId = getOrderId(session);

        await markPaymentFailed(session);

        break;
      }

      default:
        console.log("Ignored Stripe event:", event.type);
    }

    // -------------------------------------------------------
    // 3. Log the event only AFTER successful processing.
    // If processing fails we return 500 so Stripe can retry.
    // -------------------------------------------------------
    const { error: eventLogError } = await supabase
      .from("stripe_webhook_events")
      .insert({
        event_id: event.id,
        event_type: event.type,
        order_id: orderId,
        payload: {
          livemode: event.livemode,
          created: event.created,
        },
      });

    if (eventLogError) {
      // Race-safe handling if two deliveries arrive together.
      if (String(eventLogError.code) === "23505") {
        return jsonResponse({
          received: true,
          duplicate: true,
          event_id: event.id,
        });
      }

      throw eventLogError;
    }

    return jsonResponse({
      received: true,
      event_id: event.id,
      event_type: event.type,
      order_id: orderId,
    });
  } catch (error) {
    console.error("Stripe webhook processing error:", error);

    return jsonResponse(
      {
        received: false,
        error:
          error instanceof Error
            ? error.message
            : "Webhook processing failed",
      },
      500,
    );
  }
});

// ===========================================================
// PAID FULFILLMENT
// ===========================================================

async function fulfillPaidOrder(
  session: Stripe.Checkout.Session,
) {
  const orderId = getOrderId(session);

  if (!orderId) {
    throw new Error(
      `Stripe session ${session.id} has no order_id metadata`,
    );
  }

  if (session.payment_status !== "paid") {
    throw new Error(
      `Stripe session ${session.id} is not paid`,
    );
  }

  // -------------------------------------------------------
  // A. Load our authoritative Order
  // -------------------------------------------------------
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    throw new Error(
      orderError?.message || `Order ${orderId} not found`,
    );
  }

  // -------------------------------------------------------
  // B. Verify Stripe session belongs to this Order
  // -------------------------------------------------------
  if (
    order.stripe_checkout_session_id &&
    String(order.stripe_checkout_session_id) !== session.id
  ) {
    throw new Error(
      "Stripe Checkout Session does not match Order",
    );
  }

  const sessionCurrency =
    String(session.currency || "").toLowerCase();

  const orderCurrency =
    String(order.currency || "thb").toLowerCase();

  if (sessionCurrency !== orderCurrency) {
    throw new Error(
      `Currency mismatch: Stripe=${sessionCurrency}, Order=${orderCurrency}`,
    );
  }

  const stripeAmountTotalSatang =
    Number(session.amount_total || 0);

  const orderAmountSatang =
    Math.round(Number(order.total_amount || 0) * 100);

  if (stripeAmountTotalSatang !== orderAmountSatang) {
    throw new Error(
      `Amount mismatch: Stripe=${stripeAmountTotalSatang}, Order=${orderAmountSatang}`,
    );
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  // -------------------------------------------------------
  // C. Update payment first.
  // -------------------------------------------------------
  const { error: paymentUpdateError } = await supabase
    .from("payments")
    .update({
      status: "paid",
      stripe_payment_status: "paid",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
    })
    .eq("order_id", orderId)
    .eq("provider", "stripe");

  if (paymentUpdateError) {
    throw paymentUpdateError;
  }

  // -------------------------------------------------------
  // D. Mark Order paid.
  // Re-running this is safe.
  // -------------------------------------------------------
  const paidAt =
    order.paid_at || new Date().toISOString();

  const { error: orderUpdateError } = await supabase
    .from("orders")
    .update({
      // Stripe ยืนยันว่าชำระเงินสำเร็จแล้ว
      // จึงอนุมัติออเดอร์อัตโนมัติทันที
      status: "approved",
      payment_provider: "stripe",
      currency: sessionCurrency,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: paidAt,
    })
    .eq("id", orderId);

  if (orderUpdateError) {
    throw orderUpdateError;
  }

  // -------------------------------------------------------
  // E. SAME BEHAVIOR AS THE OLD SYSTEM:
  // After successful payment, notify customer in LINE by
  // calling the existing send-order-approved Edge Function.
  //
  // line_notified_at prevents normal Stripe retries from
  // sending the same LINE Flex message again.
  // -------------------------------------------------------
  const { data: freshOrder, error: freshOrderError } =
    await supabase
      .from("orders")
      .select("id,line_notified_at")
      .eq("id", orderId)
      .single();

  if (freshOrderError || !freshOrder) {
    throw new Error(
      freshOrderError?.message ||
        "Unable to reload paid order",
    );
  }

  if (!freshOrder.line_notified_at) {
    await callSendOrderApproved(orderId);

    const { error: notifyStampError } = await supabase
      .from("orders")
      .update({
        line_notified_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .is("line_notified_at", null);

    if (notifyStampError) {
      throw notifyStampError;
    }
  } else {
    console.log(
      "LINE already notified for order:",
      orderId,
    );
  }

  console.log(
    "Stripe order paid + auto-approved:",
    orderId,
    session.id,
  );
}

// ===========================================================
// PROCESSING / FAILED
// ===========================================================

async function markPaymentProcessing(
  session: Stripe.Checkout.Session,
) {
  const orderId = getOrderId(session);

  if (!orderId) return;

  const { error } = await supabase
    .from("payments")
    .update({
      status: "processing",
      stripe_payment_status:
        String(session.payment_status || "unpaid"),
      stripe_checkout_session_id: session.id,
    })
    .eq("order_id", orderId)
    .eq("provider", "stripe");

  if (error) {
    throw error;
  }
}

async function markPaymentFailed(
  session: Stripe.Checkout.Session,
) {
  const orderId = getOrderId(session);

  if (!orderId) return;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  const { error: paymentError } = await supabase
    .from("payments")
    .update({
      status: "failed",
      stripe_payment_status: "failed",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      failure_message: "Stripe asynchronous payment failed",
    })
    .eq("order_id", orderId)
    .eq("provider", "stripe");

  if (paymentError) {
    throw paymentError;
  }

  const { error: orderError } = await supabase
    .from("orders")
    .update({
      status: "pending_payment",
    })
    .eq("id", orderId)
    .neq("status", "paid");

  if (orderError) {
    throw orderError;
  }
}

// ===========================================================
// EXISTING LINE FUNCTION
// ===========================================================

async function callSendOrderApproved(orderId: string) {
  const functionUrl =
    `${SUPABASE_URL}/functions/v1/send-order-approved`;

  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization:
        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      order_id: orderId,
    }),
  });

  const raw = await response.text();

  let data: Record<string, unknown> = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (
    !response.ok ||
    data.success === false
  ) {
    console.error(
      "send-order-approved failed:",
      response.status,
      data,
    );

    throw new Error(
      String(
        data.message ||
        data.error ||
        data.raw ||
        `send-order-approved failed (${response.status})`,
      ),
    );
  }

  console.log(
    "LINE send-order-approved success:",
    orderId,
  );

  return data;
}

// ===========================================================
// STRIPE HELPERS
// ===========================================================

async function retrieveCheckoutSession(
  sessionId: string,
) {
  return await stripe.checkout.sessions.retrieve(
    sessionId,
    {
      expand: ["payment_intent"],
    },
  );
}

function getOrderId(
  session: Stripe.Checkout.Session,
) {
  return (
    String(session.metadata?.order_id || "").trim() ||
    String(session.client_reference_id || "").trim() ||
    null
  );
}

// ===========================================================
// GENERAL HELPERS
// ===========================================================

function mustEnv(name: string) {
  const value =
    String(Deno.env.get(name) || "").trim();

  if (!value) {
    throw new Error(
      `Missing Edge Function secret: ${name}`,
    );
  }

  return value;
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
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
