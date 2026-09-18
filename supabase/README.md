# Supabase production backend

This folder mirrors the production Edge Functions used by the KEITA PHOTO CAMERA photo store.

## Functions

- `create-stripe-checkout` — validates LINE ID token, calculates prices on the server, creates the order/payment records, and creates Stripe Checkout.
- `stripe-webhook` — verifies Stripe webhook signatures, marks successful payments paid, auto-approves the order, and calls `send-order-approved`.
- `send-order-approved` — sends the LINE Flex confirmation after a successful/approved order.

## Secrets

Secrets are **not stored in GitHub**. Configure them only in Supabase Edge Function Secrets.

Required values include:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `SITE_URL`
- Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

Never commit live Stripe keys, webhook signing secrets, LINE tokens, or service-role keys.
