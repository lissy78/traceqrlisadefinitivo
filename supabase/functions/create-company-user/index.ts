import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { companyName, email, password, industry, description, adminId } = body;

    if (!companyName?.trim() || !email?.trim() || !password?.trim()) {
      return new Response(JSON.stringify({ error: "Nombre, correo y contraseña son obligatorios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ error: "La contraseña debe tener al menos 6 caracteres" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminToken = `Bearer ${serviceKey}`;

    // 1. Create auth user via Admin API
    const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": adminToken,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: companyName, role: "company" },
      }),
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      if (errText.includes("already") || errText.includes("exists")) {
        return new Response(JSON.stringify({ error: "Ya existe un usuario con este correo" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Error al crear usuario", details: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userData = await userRes.json();
    const userId = userData.id;

    // 2. Create company
    const companyRes = await fetch(`${supabaseUrl}/rest/v1/companies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": adminToken,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        name: companyName,
        email,
        industry: industry || "Bebidas",
        description: description || null,
        is_approved: true,
        approved_by: adminId || null,
        approved_at: new Date().toISOString(),
        created_by: adminId || null,
      }),
    });

    if (!companyRes.ok) {
      const errText = await companyRes.text();
      // Rollback: delete the auth user if company creation failed
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { "apikey": serviceKey, "Authorization": adminToken },
      });
      return new Response(JSON.stringify({ error: "Error al crear empresa", details: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyData = await companyRes.json();
    const companyId = companyData[0].id;

    // 3. Create profile linked to company
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": adminToken,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        id: userId,
        email,
        display_name: companyName,
        role: "company",
        company_id: companyId,
      }),
    });

    if (!profileRes.ok) {
      const errText = await profileRes.text();
      console.error("Profile creation failed:", errText);
    }

    return new Response(JSON.stringify({
      success: true,
      companyId,
      userId,
      email,
      message: `Empresa ${companyName} creada. La empresa puede iniciar sesión con ${email} y la contraseña asignada.`,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : "Error desconocido",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
