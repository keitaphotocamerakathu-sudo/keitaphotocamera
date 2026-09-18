# KEITA PHOTO TOOLS v17.13

- `index.html` — owner/admin production workflow
- `teach.html` — Teach KEITA + publish Master AI
- `user.html` — user workflow with license gate; refreshes Master AI before Smart Culling and HL selection
- `license.html` — license administration
- `keita-license-config.json` — Cloudflare Worker API URL
- `cloudflare-worker/` — Worker + D1 schema

## Important
Do not commit GitHub tokens, Cloudflare tokens, ADMIN_SECRET, or LICENSE_PEPPER.
`keita-master-profile.json` belongs at the repository root and should be published from Teach KEITA after training data exists.
