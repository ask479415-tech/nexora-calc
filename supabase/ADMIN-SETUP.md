# Nexora Calc Admin Panel Setup

## 1. Apply the database migration
Run the complete `supabase/admin-access.sql` file in the Supabase SQL Editor.

## 2. Register the owner account
Create an account in Nexora Calc using the email address that will own the Admin Panel. Confirm the email if Supabase requires confirmation.

## 3. Promote the owner to Admin
In Supabase SQL Editor, run this query after replacing the email:
```sql
update public.user_profiles
set role = 'admin', status = 'active', updated_at = now()
where email = 'YOUR_ADMIN_EMAIL';
```
Check that exactly one row was updated. Do not promote customer accounts.

## 4. Deploy the secure Edge Function
From the repository root, install/login to the Supabase CLI if needed, then run:
```bash
supabase login
supabase link --project-ref ptuiinqqsopflhpcygdh
supabase functions deploy admin-customers
```

The function uses the server-side `SUPABASE_SERVICE_ROLE_KEY` environment variable supplied by Supabase. If your project runtime does not provide it automatically, add the Supabase service-role/secret key as an Edge Function secret named `SUPABASE_SERVICE_ROLE_KEY`. Never put this key in Vite environment variables, source code, GitHub commits, or the Android app. Never send it in chat.

## 5. Use the Admin Panel
Sign out and sign back in with the promoted owner account. The Cloud Backup & Account section will show **Open Admin Panel**. Customer registrations appear automatically. The Edge Function verifies the signed-in user's admin role on every request; only customer accounts can be activated or deactivated.

## Security notes
- New accounts default to the `customer` role.
- Customers can read only their own access profile.
- The Edge Function checks the caller's active admin role before listing or changing accounts.
- The privileged key is used only inside the Edge Function.
