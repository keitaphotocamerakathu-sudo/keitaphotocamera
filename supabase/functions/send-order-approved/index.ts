import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err || "Unknown error");
}

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

  try {
    const body = await req.json().catch(() => ({}));
    const order_id =
      String(body.order_id || body.orderId || body.id || "").trim();

    if (!order_id) {
      return jsonResponse(
        { success: false, error: "Missing order_id" },
        400,
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LINE_CHANNEL_ACCESS_TOKEN =
      Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse(
        { success: false, error: "Missing Supabase env" },
        500,
      );
    }

    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      return jsonResponse(
        {
          success: false,
          error: "Missing LINE_CHANNEL_ACCESS_TOKEN",
        },
        500,
      );
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

    const { data: order, error: orderError } =
      await supabase
        .from("orders")
        .select("*")
        .eq("id", order_id)
        .single();

    if (orderError) {
      return jsonResponse(
        { success: false, error: orderError.message },
        500,
      );
    }

    if (!order) {
      return jsonResponse(
        { success: false, error: "Order not found" },
        404,
      );
    }

    if (!order.line_user_id) {
      return jsonResponse(
        {
          success: false,
          error: "Order has no line_user_id",
          order_id,
        },
        400,
      );
    }

    const status =
      String(order.status || "").toLowerCase();

    if (!["approved", "paid"].includes(status)) {
      return jsonResponse(
        {
          success: false,
          error: "Order is not approved/paid",
          order_id,
          status,
        },
        409,
      );
    }

    // Idempotency: if already notified, don't push twice.
    if (order.line_notified_at) {
      return jsonResponse({
        success: true,
        duplicate: true,
        message: "LINE already notified",
        order_id,
        order_no: order.order_no || String(order.id),
        line_notified_at: order.line_notified_at,
      });
    }

    const currentLang =
      ["th", "en", "ru"].includes(String(order.language || ""))
        ? String(order.language)
        : "th";

    const miniAppUrl =
      "https://miniapp.line.me/2007608963-OaN6K1n7";

    const flexTexts: Record<string, any> = {
      th: {
        altText: "ชำระเงินสำเร็จและอนุมัติคำสั่งซื้อแล้ว",
        approvedTitle: "✅ ชำระเงินสำเร็จ",
        orderNo: "เลขที่คำสั่งซื้อ",
        approvedMessage:
          "ระบบอนุมัติคำสั่งซื้อของคุณอัตโนมัติแล้ว สามารถเข้าไปดาวน์โหลดภาพได้ทันที",
        viewOrder: "ดูออเดอร์ของฉัน",
      },
      en: {
        altText: "Payment successful and order approved",
        approvedTitle: "✅ Payment Successful",
        orderNo: "Order No.",
        approvedMessage:
          "Your order has been approved automatically. Your photos are ready to download.",
        viewOrder: "View My Order",
      },
      ru: {
        altText: "Оплата прошла успешно, заказ одобрен",
        approvedTitle: "✅ Оплата прошла успешно",
        orderNo: "Номер заказа",
        approvedMessage:
          "Ваш заказ одобрен автоматически. Фотографии готовы к скачиванию.",
        viewOrder: "Посмотреть заказ",
      },
    };

    const text = flexTexts[currentLang] || flexTexts.th;
    const orderNo = order.order_no || String(order.id);

    const payload = {
      to: order.line_user_id,
      messages: [
        {
          type: "flex",
          altText: text.altText,
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text: text.approvedTitle,
                  weight: "bold",
                  size: "xl",
                  color: "#16A34A",
                  wrap: true,
                },
                {
                  type: "text",
                  text: `${text.orderNo}: ${orderNo}`,
                  size: "sm",
                  color: "#334155",
                  wrap: true,
                },
                {
                  type: "text",
                  text: text.approvedMessage,
                  size: "sm",
                  color: "#64748B",
                  wrap: true,
                },
              ],
            },
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  color: "#111827",
                  action: {
                    type: "uri",
                    label: text.viewOrder,
                    uri: miniAppUrl,
                  },
                },
              ],
            },
          },
        },
      ],
    };

    const lineRes = await fetch(
      "https://api.line.me/v2/bot/message/push",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(payload),
      },
    );

    const lineText = await lineRes.text();

    if (!lineRes.ok) {
      console.error(
        "LINE push failed:",
        lineRes.status,
        lineText,
      );

      return jsonResponse(
        {
          success: false,
          error: "LINE push failed",
          line_status: lineRes.status,
          line_response: lineText,
          order_id,
        },
        502,
      );
    }

    const notifiedAt = new Date().toISOString();

    const { error: stampError } = await supabase
      .from("orders")
      .update({ line_notified_at: notifiedAt })
      .eq("id", order_id)
      .is("line_notified_at", null);

    if (stampError) {
      console.warn(
        "LINE sent but line_notified_at update failed:",
        stampError,
      );
    }

    return jsonResponse({
      success: true,
      message: "ส่ง Flex Message ให้ลูกค้าแล้ว",
      order_id,
      order_no: orderNo,
      language: currentLang,
      line_notified_at: notifiedAt,
    });
  } catch (err) {
    console.error("send-order-approved error:", err);

    return jsonResponse(
      {
        success: false,
        error: getErrorMessage(err),
      },
      500,
    );
  }
});