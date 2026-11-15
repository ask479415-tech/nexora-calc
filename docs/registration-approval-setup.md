# Nexora Calc registration and approval backend

This migration adds the online approval database. The existing calculator, OCR, billing, PDF and history code is not changed by this migration.

## Registration flow
- The user app submits Name, Email, Mobile Number, Address and Company Name once.
- The database returns a random access token. The app must store it in device-only storage.
- The registration starts as `pending`; the app must not show calculator features until approved.
- On every launch and periodically while active, the app calls `nexora_check_access`. Any status other than `approved`, a missing response, or no internet must keep the calculator locked.
- Deactivate/reject/delete in the admin app immediately blocks access on the next status check. The admin remove action is a soft delete so audit/history can be retained.

## Supabase setup (required before live testing)
1. Create a Supabase project.
2. Open SQL Editor and run both migrations in order: `supabase/migrations/202611150001_user_approval.sql`, then `supabase/migrations/202611150002_bank_details.sql`.
3. Create the app's public client configuration in `.env` (never put the service-role key in the mobile app):
   - `VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`
4. Create the first admin using Supabase Auth (email/password is for the separate admin app only). Insert that authenticated user's UUID into `public.nexora_admins` from the SQL Editor:
   `insert into public.nexora_admins(user_id) values ('AUTH_USER_UUID');`

## Admin RPCs
The separate Nexora Admin App should sign in an administrator with Supabase Auth and call:
- `nexora_admin_list_users()` — registration details and total registered count
- `nexora_admin_set_status({p_user_id, p_status})` — `approved`, `rejected`, or `deactivated`
- `nexora_admin_remove_user({p_user_id})` — soft-remove and revoke access

## Bank details migration
- Each approved user can store their own account holder name, bank name, account number, IFSC, branch and optional UPI ID.
- `nexora_get_bank_details({p_access_token})` returns the bank details for the approved device token.
- `nexora_save_bank_details({...})` saves the details for that approved user only.
- Bank details are stored separately from registration data and are not included in the admin registration list.

The user-facing calculator app has no password or login screen. Do not ship the Supabase service-role key in either app.

## Separate Nexora Admin App
- The standalone admin source is in `admin-app/`; it is a separate Vite/React application and does not alter the calculator app build.
- Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the admin app build environment. Use only the public anon/publishable key, never the service-role key.
- Install/build locally from `admin-app/` using `npm install` then `npm run build`.
- GitHub Actions workflow `.github/workflows/admin-app-build.yml` builds the admin portal and uploads `Nexora-Admin-Web`.
- Create the first administrator in Supabase Authentication (email/password), then add that Auth user's UUID to `public.nexora_admins` using the SQL statement above. Merely creating an Auth user does not grant admin rights.
- The admin portal uses Supabase email/password Auth and the protected admin RPCs. It does not expose a service-role credential.
- Do not publish the admin portal publicly until Supabase URL/key are configured and the first admin membership has been verified.

## GitHub Actions configuration
In the repository Settings → Secrets and variables → Actions, add these repository secrets:
- `VITE_SUPABASE_URL` — the Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` — the public anon/publishable key only.

Both Android and Admin build workflows read these secrets at build time. If they are missing, the apps compile without a live Supabase connection and the user app remains on its setup screen. Never add a `service_role` key.
