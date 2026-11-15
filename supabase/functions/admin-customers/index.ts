import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ error: "Please sign in first." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete. Ask the project owner to check Edge Function secrets." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return jsonResponse({ error: "Your session is invalid. Please sign in again." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from("user_profiles")
    .select("role, status")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError) return jsonResponse({ error: "Could not verify administrator access." }, 500);
  if (!profile || profile.role !== "admin" || profile.status !== "active") {
    return jsonResponse({ error: "Administrator permission required." }, 403);
  }

  let body: { action?: string; user_id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  if (body.action === "list") {
    const { data, error } = await adminClient
      .from("user_profiles")
      .select("user_id, email, status, created_at, full_name, phone, address, company_name, bank_holder_name, bank_name, account_number, ifsc_code")
      .eq("role", "customer")
      .order("created_at", { ascending: false });
    if (error) return jsonResponse({ error: "Could not load customer accounts." }, 500);
    return jsonResponse({ customers: data || [] });
  }

  if (body.action === "set-status") {
    const userId = String(body.user_id || "");
    const status = body.status;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return jsonResponse({ error: "Invalid customer account." }, 400);
    }
    if (status !== "active" && status !== "inactive") {
      return jsonResponse({ error: "Status must be active or inactive." }, 400);
    }

    const { data: target, error: targetError } = await adminClient
      .from("user_profiles")
      .select("user_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (targetError) return jsonResponse({ error: "Could not verify the selected account." }, 500);
    if (!target || target.role !== "customer") {
      return jsonResponse({ error: "Only customer accounts can be changed here." }, 404);
    }

    const { data: updated, error: updateError } = await adminClient
      .from("user_profiles")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select("user_id, email, status, created_at, full_name, phone, address, company_name, bank_holder_name, bank_name, account_number, ifsc_code")
      .single();
    if (updateError) return jsonResponse({ error: "Customer status update failed." }, 500);
    return jsonResponse({ customer: updated });
  }

  return jsonResponse({ error: "Unknown admin action." }, 400);
});
