-- Production security hardening for KEITA PHOTO CAMERA
-- Client (anon/authenticated) must not access server-only tables.

ALTER TABLE public."userLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."userLine" FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon, authenticated;

GRANT ALL ON TABLE public."userLine" TO service_role;
GRANT ALL ON TABLE public.stripe_webhook_events TO service_role;

-- Fix mutable search_path warnings on trigger functions.
ALTER FUNCTION public.generate_order_no()
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.set_updated_at()
  SET search_path = public, extensions, pg_temp;
