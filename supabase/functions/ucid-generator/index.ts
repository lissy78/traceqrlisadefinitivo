import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEX_128_REGEX = /^[a-f0-9]{128}$/i;

type ProfileRole = "admin" | "company" | "student";

interface Profile {
  id: string;
  role: ProfileRole;
  company_id: string | null;
}

interface UCIDBatch {
  id: string;
  company_id: string;
  batch_name: string;
  quantity: number;
  ucid_prefix: string;
  status: string;
  batch_hash: string | null;
  generated_count: number | null;
  product_name: string | null;
  product_brand: string | null;
  container_type: string | null;
  qr_strategy: string | null;
  created_at: string | null;
  generated_at: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Falta variable de entorno: ${name}`);
  }
  return value;
}

function bytesToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha512Hex(data: string) {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-512", encoded);
  return bytesToHex(hash);
}

async function hmacSha256Hex(secret: string, data: string) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return bytesToHex(signature);
}

function buildShortCode(batchId: string, index: number) {
  const batchKey = batchId.replaceAll("-", "").slice(0, 4).toUpperCase();
  const indexCode = index.toString(36).toUpperCase().padStart(4, "0").slice(-4);

  return `${batchKey}${indexCode}`;
}

async function buildToken(batch: UCIDBatch, index: number, shortCode: string) {
  if (!batch.batch_hash) {
    throw new Error("El lote no tiene batch_hash");
  }

  const payload = [
    "TraceQR",
    "option-b",
    batch.batch_hash,
    batch.id,
    batch.company_id,
    batch.ucid_prefix,
    index,
    shortCode,
  ].join(":");

  return await sha512Hex(payload);
}

function buildQrUrl(baseUrl: string, batch: UCIDBatch, index: number, shortCode: string, token: string) {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");

  const params = new URLSearchParams({
    batch: batch.id,
    index: String(index),
    token,
  });

  return `${cleanBaseUrl}/s/${shortCode}/${token.slice(0, 16)}?${params.toString()}`;
}

function parseQrData(qrData: string) {
  try {
    const url = new URL(qrData);

    return {
      batchId: url.searchParams.get("batch"),
      index: Number(url.searchParams.get("index")),
      token: url.searchParams.get("token"),
    };
  } catch {
    const match = qrData.match(/batch=([0-9a-f-]+).*index=([0-9]+).*token=([a-f0-9]{128})/i);

    if (!match) {
      return {
        batchId: null,
        index: 0,
        token: null,
      };
    }

    return {
      batchId: match[1],
      index: Number(match[2]),
      token: match[3],
    };
  }
}

async function fetchJson(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  }

  return data;
}

function serviceHeaders() {
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
}

async function getUserFromRequest(req: Request) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token || token === serviceRoleKey) {
    return null;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

async function getProfile(userId: string): Promise<Profile | null> {
  const supabaseUrl = requireEnv("SUPABASE_URL");

  const data = await fetchJson(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=id,role,company_id&limit=1`,
    {
      method: "GET",
      headers: serviceHeaders(),
    },
  ) as Profile[];

  return data[0] ?? null;
}

async function getBatch(batchId: string): Promise<UCIDBatch | null> {
  const supabaseUrl = requireEnv("SUPABASE_URL");

  const select = [
    "id",
    "company_id",
    "batch_name",
    "quantity",
    "ucid_prefix",
    "status",
    "batch_hash",
    "generated_count",
    "product_name",
    "product_brand",
    "container_type",
    "qr_strategy",
    "created_at",
    "generated_at",
  ].join(",");

  const data = await fetchJson(
    `${supabaseUrl}/rest/v1/ucid_batches?id=eq.${batchId}&select=${select}&limit=1`,
    {
      method: "GET",
      headers: serviceHeaders(),
    },
  ) as UCIDBatch[];

  return data[0] ?? null;
}

function canManageBatch(profile: Profile, batch: UCIDBatch) {
  if (profile.role === "admin") return true;
  if (profile.role === "company" && profile.company_id === batch.company_id) return true;

  return false;
}

async function handleGenerate(req: Request, body: Record<string, unknown>) {
  const batchId = String(body.batchId || "");
  const companyId = String(body.companyId || "");
  const quantity = Number(body.quantity || 0);
  const productInfo = body.productInfo as {
    name?: string | null;
    brand?: string | null;
    containerType?: string | null;
  } | null;

  if (!UUID_REGEX.test(batchId) || !UUID_REGEX.test(companyId)) {
    return jsonResponse({ error: "batchId y companyId deben ser UUID validos" }, 400);
  }

  if (!quantity || quantity < 1 || quantity > 100000) {
    return jsonResponse({ error: "La cantidad debe estar entre 1 y 100000" }, 400);
  }

  const user = await getUserFromRequest(req);

  if (!user?.id) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  const profile = await getProfile(user.id);

  if (!profile) {
    return jsonResponse({ error: "Perfil no encontrado" }, 403);
  }

  const batch = await getBatch(batchId);

  if (!batch) {
    return jsonResponse({ error: "Lote no encontrado" }, 404);
  }

  if (batch.company_id !== companyId) {
    return jsonResponse({ error: "El lote no pertenece a esa empresa" }, 403);
  }

  if (!canManageBatch(profile, batch)) {
    return jsonResponse({ error: "No tienes permisos para generar este lote" }, 403);
  }

  const signingSecret = requireEnv("UCID_BATCH_SIGNING_SECRET");
  const generatedAt = new Date().toISOString();

  const batchHashPayload = JSON.stringify({
    app: "TraceQR",
    version: "option-b",
    batchId,
    companyId,
    ucidPrefix: batch.ucid_prefix,
    quantity,
    generatedAt,
  });

  const batchHash = await hmacSha256Hex(signingSecret, batchHashPayload);

  const supabaseUrl = requireEnv("SUPABASE_URL");

  await fetchJson(`${supabaseUrl}/rest/v1/ucid_batches?id=eq.${batchId}`, {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      status: "ready",
      batch_hash: batchHash,
      generated_count: quantity,
      generated_at: generatedAt,
      product_name: productInfo?.name?.slice(0, 200) || null,
      product_brand: productInfo?.brand?.slice(0, 100) || null,
      container_type: productInfo?.containerType?.slice(0, 50) || "PET",
      qr_strategy: "batch_hash",
    }),
  });

  return jsonResponse({
    success: true,
    batchId,
    quantity,
    generated: quantity,
    strategy: "batch_hash",
    message: `Lote generado con batch_hash. No se insertaron filas en ucids.`,
  });
}

async function handleExport(req: Request, body: Record<string, unknown>) {
  const batchId = String(body.batchId || "");

  if (!UUID_REGEX.test(batchId)) {
    return jsonResponse({ error: "batchId invalido" }, 400);
  }

  const user = await getUserFromRequest(req);

  if (!user?.id) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  const profile = await getProfile(user.id);

  if (!profile) {
    return jsonResponse({ error: "Perfil no encontrado" }, 403);
  }

  const batch = await getBatch(batchId);

  if (!batch) {
    return jsonResponse({ error: "Lote no encontrado" }, 404);
  }

  if (!canManageBatch(profile, batch)) {
    return jsonResponse({ error: "No tienes permisos para exportar este lote" }, 403);
  }

  if (!batch.batch_hash) {
    return jsonResponse({ error: "Este lote todavia no tiene batch_hash. Primero generarlo." }, 400);
  }

  const baseUrl = Deno.env.get("APP_BASE_URL") || "https://traceqr.app";
  const total = Math.min(batch.quantity, 100000);
  const ucids = [];

  for (let index = 1; index <= total; index++) {
    const shortCode = buildShortCode(batch.id, index);
    const token = await buildToken(batch, index, shortCode);
    const qrData = buildQrUrl(baseUrl, batch, index, shortCode, token);

    ucids.push({
      index,
      batch_id: batch.id,
      batch_name: batch.batch_name,
      short_code: shortCode,
      qr_data: qrData,
      ucid_hash: token,
      product_name: batch.product_name,
      product_brand: batch.product_brand,
      container_type: batch.container_type || "PET",
      status: "unused",
    });
  }

  return jsonResponse({
    success: true,
    strategy: "batch_hash",
    batch: {
      id: batch.id,
      company_id: batch.company_id,
      batch_name: batch.batch_name,
      quantity: batch.quantity,
      ucid_prefix: batch.ucid_prefix,
      product_name: batch.product_name,
      product_brand: batch.product_brand,
      container_type: batch.container_type || "PET",
    },
    ucids,
    total: ucids.length,
  });
}

async function handleValidate(body: Record<string, unknown>) {
  let batchId = String(body.batchId || "");
  let index = Number(body.index || 0);
  let token = String(body.token || body.ucidHash || "");

  const qrData = String(body.qrData || "");

  if (qrData) {
    const parsed = parseQrData(qrData);
    batchId = parsed.batchId || batchId;
    index = parsed.index || index;
    token = parsed.token || token;
  }

  if (!UUID_REGEX.test(batchId)) {
    return jsonResponse({ valid: false, error: "batchId invalido" }, 400);
  }

  if (!index || index < 1) {
    return jsonResponse({ valid: false, error: "Indice invalido" }, 400);
  }

  if (!HEX_128_REGEX.test(token)) {
    return jsonResponse({ valid: false, error: "Token invalido o incompleto" }, 400);
  }

  const batch = await getBatch(batchId);

  if (!batch) {
    return jsonResponse({ valid: false, error: "Lote no encontrado" });
  }

  if (!batch.batch_hash) {
    return jsonResponse({ valid: false, error: "El lote no tiene batch_hash" });
  }

  if (index > batch.quantity) {
    return jsonResponse({ valid: false, error: "El indice no pertenece a este lote" });
  }

  const shortCode = buildShortCode(batch.id, index);
  const expectedToken = await buildToken(batch, index, shortCode);

  if (expectedToken !== token.toLowerCase()) {
    return jsonResponse({ valid: false, error: "QR invalido o falsificado" });
  }

  return jsonResponse({
    valid: true,
    data: {
      ucid_id: null,
      batch_id: batch.id,
      company_id: batch.company_id,
      batch_name: batch.batch_name,
      ucid_hash: expectedToken,
      short_code: shortCode,
      product_name: batch.product_name,
      product_brand: batch.product_brand,
      container_type: batch.container_type || "PET",
      status: "unused",
      strategy: "batch_hash",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json();
    const action = body.action;

    if (action === "generate") {
      return await handleGenerate(req, body);
    }

    if (action === "export") {
      return await handleExport(req, body);
    }

    if (action === "validate") {
      return await handleValidate(body);
    }

    return jsonResponse({ error: "Accion invalida" }, 400);
  } catch (error) {
    console.error("ucid-generator error:", error);

    return jsonResponse(
      {
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      500,
    );
  }
});