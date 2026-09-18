Deno.serve(() => {
  return new Response(
    JSON.stringify({
      success: false,
      error: "Stripe Live webhook setup is already completed",
    }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
});
