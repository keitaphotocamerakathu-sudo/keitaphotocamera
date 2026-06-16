/************************************************
 * CONFIG หลักของระบบ
 * ใช้กับ Supabase Project ใหม่ + Cloudflare R2
 ************************************************/

window.CONFIG = {
  /**********************************************
   * Supabase Project ใหม่
   * ให้เอสเปลี่ยน 2 ค่านี้เป็นของ Project ใหม่
   **********************************************/
  SUPABASE_URL: "https://yuvsusdnecrmbcsifgbk.supabase.co",

  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1dnN1c2RuZWNybWJjc2lmZ2JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1ODYwNTYsImV4cCI6MjA5NzE2MjA1Nn0.K9I4TCr2dh3DOlXp_2JQHZUATvS0kSreDZp5O3e1460",

  /**********************************************
   * LINE LIFF
   **********************************************/
  LIFF_ID: "2007608963-OaN6K1n7",

  /**********************************************
   * ราคาเริ่มต้น
   **********************************************/
  DEFAULT_PHOTO_PRICE: 50,

  /**********************************************
   * Cloudflare R2
   * ใช้ตัวเดิมที่ทำสำเร็จแล้ว
   **********************************************/
  R2_ENABLED: true,
  R2_WORKER_URL: "https://keita-r2-upload.keitaphotocamera.workers.dev",
  R2_PUBLIC_BASE_URL: "https://pub-897300534774433b18d20c62be9f282.r2.dev",

  /**********************************************
   * Storage Buckets
   * ตอนนี้รูปใช้ R2 แล้ว
   * slips ยังใช้ Supabase Storage ได้ ถ้าสร้าง bucket slips ใน Project ใหม่
   **********************************************/
  STORAGE_BUCKETS: {
    SLIPS: "slips"
  }
};

/************************************************
 * ตรวจสอบว่ามี Supabase SDK หรือไม่
 ************************************************/

if (!window.supabase) {
  console.error("❌ Supabase SDK not loaded. กรุณาเช็ก script @supabase/supabase-js");
}

/************************************************
 * Global Supabase Client
 ************************************************/

window.sb = window.supabase.createClient(
  window.CONFIG.SUPABASE_URL,
  window.CONFIG.SUPABASE_ANON_KEY
);

/************************************************
 * รองรับ code เดิม
 ************************************************/

window.supabaseClient = window.sb;

/************************************************
 * Helper สำหรับเรียก Edge Function
 ************************************************/

window.callFunction = async function (functionName, body = {}) {
  const url = `${window.CONFIG.SUPABASE_URL}/functions/v1/${functionName}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${window.CONFIG.SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.message || `Function error: ${functionName}`);
  }

  return data;
};

/************************************************
 * Helper สำหรับ R2 Upload
 ************************************************/

window.uploadToR2 = async function (file, eventId, folder = "preview") {
  if (!window.CONFIG.R2_ENABLED) {
    throw new Error("R2 ยังไม่ได้เปิดใช้งาน");
  }

  if (!window.CONFIG.R2_WORKER_URL) {
    throw new Error("ไม่พบ R2_WORKER_URL");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("event_id", eventId);
  formData.append("folder", folder);

  const res = await fetch(`${window.CONFIG.R2_WORKER_URL}/upload`, {
    method: "POST",
    body: formData
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.success) {
    throw new Error(data?.message || "Upload to R2 failed");
  }

  return data;
};

/************************************************
 * Debug
 ************************************************/

console.log("✅ CONFIG Loaded");
console.log("Supabase URL:", window.CONFIG.SUPABASE_URL);
console.log("R2 Worker:", window.CONFIG.R2_WORKER_URL);
