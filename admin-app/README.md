# Nexora Admin

Standalone administrator portal for Nexora Calc.

## Local build
1. Copy `.env.example` to `.env`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Supabase project URL and public anon/publishable key.
3. Run `npm install` and `npm run build`.

Only authenticated users whose Supabase Auth UUID is present in `public.nexora_admins` can access the registration management RPC. Never place the Supabase service-role key in this app.

GitHub Actions builds this folder separately and uploads the static web portal as `Nexora-Admin-Web`.

## Build and live-connection status
The source can be built without Supabase secrets, but the resulting portal will show the configuration-missing screen and cannot manage registrations until the public Supabase URL and anon/publishable key are configured in the build environment. The same applies to the Android app: its registration/approval gate remains locked on the setup screen until those values are supplied and the database migrations have been applied.
