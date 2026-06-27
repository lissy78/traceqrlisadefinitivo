import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Generate SHA-256 hash using Web Crypto API (Deno compatible)
async function generateHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate random hex string
function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

// Generate short human-readable code (8 chars)
function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars: I, O, 0, 1
  let code = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// Generate UCID hash with high entropy (128 chars = 512 bits)
async function generateUCIDHash(companyId: string, batchId: string, index: number, timestamp: number): Promise<string> {
  // Combine multiple entropy sources for uniqueness
  const entropy = [
    companyId,
    batchId,
    index.toString(),
    timestamp.toString(),
    randomHex(32),
    crypto.randomUUID(),
    Deno.pid?.toString() || '0',
  ].join(':');

  // Double hash for extra security and length
  const firstHash = await generateHash(entropy);
  const secondHash = await generateHash(firstHash + randomHex(16));

  // Return 128 char hex (512 bits equivalent entropy)
  return (firstHash + secondHash).slice(0, 128);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { method } = req;
    const url = new URL(req.url);

    if (method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, batchId, companyId, quantity, productInfo } = body;

    // Validate UCID - Check if it exists and is unused
    if (action === "validate") {
      const { ucidHash } = body;
      if (!ucidHash) {
        return new Response(JSON.stringify({ error: "ucidHash required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Query the database function
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/validate_ucid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ p_ucid_hash: ucidHash }),
      });

      const result = await response.json();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate batch of UCIDs
    if (action === "generate") {
      if (!batchId || !companyId || !quantity) {
        return new Response(JSON.stringify({ error: "batchId, companyId, and quantity required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (quantity < 1 || quantity > 100000) {
        return new Response(JSON.stringify({ error: "Quantity must be between 1 and 100000" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const timestamp = Date.now();
      const baseUrl = Deno.env.get("APP_BASE_URL") || "https://traceqr.app";
      const ucids: Array<{
        batch_id: string;
        company_id: string;
        ucid_hash: string;
        short_code: string;
        qr_data: string;
        product_name: string | null;
        product_brand: string | null;
        container_type: string;
      }> = [];

      // Generate UCIDs in batches for efficiency
      for (let i = 0; i < quantity; i++) {
        const ucidHash = await generateUCIDHash(companyId, batchId, i, timestamp);
        const shortCode = generateShortCode();
        const qrData = `${baseUrl}/s/${shortCode}/${ucidHash.slice(0, 16)}`;

        ucids.push({
          batch_id: batchId,
          company_id: companyId,
          ucid_hash: ucidHash,
          short_code: shortCode,
          qr_data: qrData,
          product_name: productInfo?.name || null,
          product_brand: productInfo?.brand || null,
          container_type: productInfo?.containerType || "PET",
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
        return new Response(JSON.stringify({ error: "Failed to insert UCIDs", details: errorText }), {
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
        quantity,
        generated: ucids.length,
        message: `Generated ${ucids.length} unique UCIDs`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export UCIDs as printable QR codes
    if (action === "export") {
      const { batchId: exportBatchId } = body;
      if (!exportBatchId) {
        return new Response(JSON.stringify({ error: "batchId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const response = await fetch(`${supabaseUrl}/rest/v1/ucids?batch_id=eq.${exportBatchId}&select=short_code,qr_data,ucid_hash,product_name,product_brand,status`, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
      });

      const ucids = await response.json();

      // Mark batch as printed
      await fetch(`${supabaseUrl}/rest/v1/ucid_batches?id=eq.${exportBatchId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          status: "printed",
          printed_at: new Date().toISOString(),
        }),
      });

      return new Response(JSON.stringify({
        success: true,
        ucids,
        total: ucids.length,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});