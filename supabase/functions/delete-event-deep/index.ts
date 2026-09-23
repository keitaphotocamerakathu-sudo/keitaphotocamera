import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function uniq(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function extractR2Key(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("events/")) return raw.replace(/^\/+/, "");
  const marker = "/file/";
  if (raw.includes(marker)) {
    return decodeURIComponent(raw.split(marker)[1] || "").replace(/^\/+/, "");
  }
  return "";
}

function collectEventR2Keys(record: any, eventId: string) {
  if (!record || typeof record !== "object") return [];
  const prefix = `events/${eventId}/`;
  const found: string[] = [];
  for (const value of Object.values(record)) {
    if (typeof value !== "string") continue;
    const key = extractR2Key(value);
    if (key && key.startsWith(prefix)) found.push(key);
  }
  return found;
}

function extractSlipPath(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    return raw.replace(/^slips\//, "").replace(/^\/+/, "");
  }
  const marker = "/storage/v1/object/public/slips/";
  if (raw.includes(marker)) {
    return decodeURIComponent(raw.split(marker)[1] || "").replace(/^\/+/, "");
  }
  return "";
}

function isNotFoundResponse(status: number, data: any, text: string) {
  if (status === 404) return true;
  const msg = String(data?.message || data?.error || text || "").toLowerCase();
  return msg.includes("not found") || msg.includes("does not exist") || msg.includes("no such");
}

async function deleteR2Key(workerUrl: string, key: string) {
  if (!workerUrl) {
    return { success: false, key, message: "Missing R2_WORKER_URL" };
  }
  const res = await fetch(`${workerUrl.replace(/\/+$/, "")}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (isNotFoundResponse(res.status, data, text)) {
    return { success: true, key, already_absent: true };
  }
  if (!res.ok || data?.success === false) {
    return { success: false, key, status: res.status, response: data };
  }
  return { success: true, key, response: data };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function must(label: string, promise: Promise<any>) {
  const result = await promise;
  if (result?.error) throw new Error(`${label}: ${result.error.message || result.error}`);
  return result;
}

async function countRowsEq(supabase: any, table: string, column: string, value: any) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw error;
  return Number(count || 0);
}

async function countRowsIn(supabase: any, table: string, column: string, values: any[]) {
  if (!values.length) return 0;
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .in(column, values);
  if (error) throw error;
  return Number(count || 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const eventId = String(body.event_id || body.id || "").trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      return json({ success: false, message: "Invalid event_id" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const R2_WORKER_URL = Deno.env.get("R2_WORKER_URL") || "";

    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
    if (!SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    if (!R2_WORKER_URL) throw new Error("Missing R2_WORKER_URL");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: event, error: eventError } = await supabase
      .from("events").select("*").eq("id", eventId).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return json({ success: false, message: "Event not found" }, 404);

    const [{ data: photos, error: photosError }, { data: orders, error: ordersError }, { data: eventItems, error: itemsError }] =
      await Promise.all([
        supabase.from("photos").select("*").eq("event_id", eventId),
        supabase.from("orders").select("*").eq("event_id", eventId),
        supabase.from("order_items").select("*").eq("event_id", eventId),
      ]);

    if (photosError) throw photosError;
    if (ordersError) throw ordersError;
    if (itemsError) throw itemsError;

    const orderIds = (orders || []).map((o: any) => String(o.id)).filter(Boolean);

    let payments: any[] = [];
    if (orderIds.length) {
      const { data, error } = await supabase.from("payments").select("*").in("order_id", orderIds);
      if (error) throw error;
      payments = data || [];
    }

    const r2Keys = uniq([
      ...collectEventR2Keys(event, eventId),
      ...(photos || []).flatMap((row: any) => collectEventR2Keys(row, eventId)),
      ...(eventItems || []).flatMap((row: any) => collectEventR2Keys(row, eventId)),
      ...(orders || []).flatMap((row: any) => collectEventR2Keys(row, eventId)),
    ]);

    const slipPaths = uniq(
      payments.flatMap((payment: any) => [
        extractSlipPath(payment.slip_path),
        extractSlipPath(payment.slip_url),
      ])
    );

    const r2DeleteResults = await mapLimit(r2Keys, 8, (key) => deleteR2Key(R2_WORKER_URL, key));
    const r2Failures = r2DeleteResults.filter((x: any) => !x?.success);

    if (r2Failures.length) {
      return json({
        success: false,
        message: "R2 delete incomplete; database was kept so deletion can be retried safely",
        event_id: eventId,
        failed_r2_files: r2Failures,
        deleted_r2_files: r2DeleteResults.filter((x: any) => x?.success).length,
      }, 502);
    }

    const slipDeleteResults: any[] = [];
    for (const paths of chunk(slipPaths, 100)) {
      const { data, error } = await supabase.storage.from("slips").remove(paths);
      slipDeleteResults.push({ paths: paths.length, data, error: error?.message || null });
      if (error) {
        return json({
          success: false,
          message: "Slip delete incomplete; database was kept so deletion can be retried safely",
          event_id: eventId,
          slip_error: error.message,
        }, 502);
      }
    }

    if (orderIds.length) {
      await must("delete stripe_webhook_events by order", supabase.from("stripe_webhook_events").delete().in("order_id", orderIds));
    }
    await must("delete stripe_webhook_events by event", supabase.from("stripe_webhook_events").delete().eq("event_id", eventId));

    if (orderIds.length) {
      await must("delete payments", supabase.from("payments").delete().in("order_id", orderIds));
      await must("delete order_items by order", supabase.from("order_items").delete().in("order_id", orderIds));
    }
    await must("delete order_items by event", supabase.from("order_items").delete().eq("event_id", eventId));
    await must("delete orders", supabase.from("orders").delete().eq("event_id", eventId));
    await must("delete faces", supabase.from("faces").delete().eq("event_id", eventId));
    await must("delete photos", supabase.from("photos").delete().eq("event_id", eventId));
    await must("delete event", supabase.from("events").delete().eq("id", eventId));

    const verification: Record<string, number> = {};
    verification.events = await countRowsEq(supabase, "events", "id", eventId);
    verification.photos = await countRowsEq(supabase, "photos", "event_id", eventId);
    verification.faces = await countRowsEq(supabase, "faces", "event_id", eventId);
    verification.orders = await countRowsEq(supabase, "orders", "event_id", eventId);
    verification.order_items = await countRowsEq(supabase, "order_items", "event_id", eventId);
    verification.webhooks_by_event = await countRowsEq(supabase, "stripe_webhook_events", "event_id", eventId);

    verification.payments = await countRowsIn(supabase, "payments", "order_id", orderIds);
    verification.webhooks_by_order = await countRowsIn(supabase, "stripe_webhook_events", "order_id", orderIds);

    const remaining = Object.entries(verification).filter(([, count]) => count > 0);
    if (remaining.length) {
      return json({
        success: false,
        message: "Database verification failed after delete",
        event_id: eventId,
        remaining: Object.fromEntries(remaining),
      }, 500);
    }

    return json({
      success: true,
      message: "Event deleted completely",
      event_id: eventId,
      deleted: {
        r2_files: r2Keys.length,
        slip_files: slipPaths.length,
        photos: (photos || []).length,
        orders: orderIds.length,
        payments: payments.length,
        order_items: (eventItems || []).length,
        faces: "deleted by event_id",
        stripe_webhook_events: "deleted by event/order",
        event: 1,
      },
      verification,
      r2DeleteResults,
      slipDeleteResults,
    });
  } catch (err) {
    console.error(err);
    return json({ success: false, message: err?.message || String(err) }, 500);
  }
});
