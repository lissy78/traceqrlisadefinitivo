import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Rate limiting store (in-memory, resets on function cold start)
const rateLimitStore = new Map<string, { count: number; lastRequest: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute for generate

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now - entry.lastRequest > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(key, { count: 1, lastRequest: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  entry.lastRequest = now;
  return true;
}

// Generate SHA-256 hash using Web Crypto API (Deno compatible)
async function generateHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate random hex string using crypto.getRandomValues
function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

// Generate short human-readable code (8 chars) with HIGH entropy
function generateShortCode(): string {
  // Use only unambiguous characters
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const charsLength = chars.length;
  // Need at least 5 bits per character for true randomness
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  // Use rejection sampling for uniform distribution
  for (let i = 0; i < 8; i++) {
    // Simple modulo is fine for this size
    code += chars[bytes[i] % charsLength];
  }
  return code;
}

// Validate hex string format
function isValidHexHash(hash: string): boolean {
  return /^[a-f0-9]{128}$/i.test(hash);
}

// Validate short code format
function isValidShortCode(code: string): boolean {
  return /^[A-Z0-9]{8}$/i.test(code);
}

// Generate UCID hash with high entropy (128 chars = 512 bits)
async function generateUCIDHash(companyId: string, batchId: string, index: number, timestamp: number): Promise<string> {
  // Combine multiple entropy sources for cryptographic uniqueness
  // Total entropy: ~512 bits (company_id + batch_id + randomHex(64) + UUID + timestamp + index)
  const entropy = [
    companyId,
    batchId,
    index.toString(36),
    timestamp.toString(36),
    randomHex(64), // 256 bits of pure randomness
    crypto.randomUUID(), // 122 bits of randomness
    randomHex(32), // 128 more bits
  ].join(':');

  // Double SHA-256 hash for extra security
  const firstHash = await generateHash(entropy);
  const secondHash = await generateHash(firstHash + randomHex(32));

  // Return 128 char hex (512 bits)
  return (firstHash + secondHash).slice(0, 128);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { method } = req;

    if (method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    // Validate UCID - Check if it exists and is unused
    if (action === "validate") {
      const { ucidHash, shortCode } = body;

      // Validate input format to prevent injection
      if (ucidHash && !isValidHexHash(ucidHash)) {
        return new Response(JSON.stringify({ valid: false, error: "Formato de UCID invalido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (shortCode && !isValidShortCode(shortCode)) {
        return new Response(JSON.stringify({ valid: false, error: "Formato de codigo corto invalido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Search by either hash or short code
      let query = supabaseUrl + "/rest/v1/ucids?select=id,ucid_hash,short_code,status,company_id,product_name,product_brand,container_type,scanned_at";

      if (ucidHash) {
        query += `&ucid_hash=eq.${ucidHash.toLowerCase()}`;
      } else if (shortCode) {
        query += `&short_code=eq.${shortCode.toUpperCase()}`;
      } else {
        return new Response(JSON.stringify({ valid: false, error: "ucidHash o shortCode requerido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const response = await fetch(query, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
      });

      const ucids = await response.json();

      if (!ucids || ucids.length === 0) {
        return new Response(JSON.stringify({ valid: false, error: "UCID no encontrado" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const ucid = ucids[0];

      if (ucid.status === "scanned") {
        return new Response(JSON.stringify({
          valid: false,
          error: "Este envase ya fue escaneado anteriormente",
          scanned_at: ucid.scanned_at,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (ucid.status === "invalidated") {
        return new Response(JSON.stringify({ valid: false, error: "UCID invalidado" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        valid: true,
        ucid_id: ucid.id,
        company_id: ucid.company_id,
        product_name: ucid.product_name,
        product_brand: ucid.product_brand,
        container_type: ucid.container_type,
        short_code: ucid.short_code,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate batch of UCIDs
    if (action === "generate") {
      const { batchId, companyId, quantity, productInfo } = body;

      // Rate limiting by company
      if (!checkRateLimit(`gen:${companyId || 'anonymous'}`)) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Espera un minuto." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Validate inputs
      if (!batchId || !companyId || !quantity) {
        return new Response(JSON.stringify({ error: "batchId, companyId, y quantity son requeridos" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(batchId) || !uuidRegex.test(companyId)) {
        return new Response(JSON.stringify({ error: "Formato de ID invalido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Sanitize quantity
      const sanitizedQuantity = Math.max(1, Math.min(100000, parseInt(quantity) || 1));

      const timestamp = Date.now();
      const baseUrl = Deno.env.get("APP_BASE_URL") || "https://traceqr.app";
      const ucids = [];

      // Generate UCIDs
      for (let i = 0; i < sanitizedQuantity; i++) {
        const ucidHash = await generateUCIDHash(companyId, batchId, i, timestamp);
        const shortCode = generateShortCode();
        const qrData = `${baseUrl}/s/${shortCode}/${ucidHash.slice(0, 16)}`;

        ucids.push({
          batch_id: batchId,
          company_id: companyId,
          ucid_hash: ucidHash,
          short_code: shortCode,
          qr_data: qrData,
          product_name: productInfo?.name?.slice(0, 200) || null,
          product_brand: productInfo?.brand?.slice(0, 100) || null,
          container_type: productInfo?.containerType?.slice(0, 50) || "PET",
        });
      }

      // Insert UCIDs into database
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const insertResponse = await fetch(`${supabaseUrl}/rest/v1/ucids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(ucids),
      });

      if (!insertResponse.ok) {
        const errorText = await insertResponse.text();
        console.error("Insert error:", errorText);
        return new Response(JSON.stringify({ error: "Error al insertar UCIDs", details: errorText }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update batch status
      await fetch(`${supabaseUrl}/rest/v1/ucid_batches?id=eq.${batchId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          status: "ready",
          generated_at: new Date().toISOString(),
        }),
      });

      return new Response(JSON.stringify({
        success: true,
        batchId,
        quantity: sanitizedQuantity,
        generated: ucids.length,
        message: `Generados ${ucids.length} UCIDs unicos`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export UCIDs
    if (action === "export") {
      const { batchId: exportBatchId } = body;

      if (!exportBatchId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(exportBatchId)) {
        return new Response(JSON.stringify({ error: "batchId invalido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const response = await fetch(`${supabaseUrl}/rest/v1/ucids?batch_id=eq.${exportBatchId}&status=eq.unused&select=short_code,qr_data,ucid_hash,product_name,product_brand,status&limit=10000`, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
      });

      const ucids = await response.json();

      return new Response(JSON.stringify({
        success: true,
        ucids,
        total: ucids.length,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Accion invalida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : "Error desconocido"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});