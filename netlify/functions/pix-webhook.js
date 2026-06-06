const https = require("https");
const crypto = require("crypto");

function hashSHA256(value) {
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(data);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function supabaseGet(supabaseUrl, serviceKey, query) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(supabaseUrl + "/rest/v1/" + query);
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey,
        "Content-Type": "application/json",
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve([]); }
      });
    }).on("error", reject);
  });
}

function supabasePatch(supabaseUrl, serviceKey, table, filter, data) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(supabaseUrl + "/rest/v1/" + table + "?" + filter);
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "PATCH",
      headers: {
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      res.on("data", () => {});
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let notification;
  try {
    notification = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido." }) };
  }

  const { transactionId, status, transactionType, clientName, clientDocument, value } = notification;

  // Só processa PIX confirmado
  if (transactionType !== "DEPOSITO" || status !== "COMPLETO") {
    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
  }

  console.log(JSON.stringify({
    event: "PIX_PAGO",
    transactionId,
    clientName,
    value,
    confirmedAt: new Date().toISOString(),
  }));

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fbPixelId = process.env.FB_PIXEL_ID || "1013829117803178";
  const fbAccessToken = process.env.FB_ACCESS_TOKEN;

  // ── Busca dados de rastreamento do lead no Supabase ──
  let fbp = null;
  let fbc = null;
  let leadEmail = null;
  let leadPhone = null;

  if (supabaseUrl && supabaseServiceKey && transactionId) {
    try {
      const leads = await supabaseGet(
        supabaseUrl,
        supabaseServiceKey,
        "leads?transaction_id=eq." + encodeURIComponent(transactionId) + "&select=email,telefone,nome,fbp,fbc&limit=1"
      );
      if (Array.isArray(leads) && leads.length > 0) {
        const lead = leads[0];
        fbp = lead.fbp || null;
        fbc = lead.fbc || null;
        leadEmail = lead.email || null;
        leadPhone = lead.telefone || null;
      }
    } catch (err) {
      console.error("Erro ao buscar lead no Supabase:", err.message);
    }
  }

  // ── Envia evento Purchase para Meta Conversions API ──
  if (fbAccessToken) {
    const userData = {};
    if (leadEmail) userData.em = [hashSHA256(leadEmail)];
    if (leadPhone) userData.ph = [hashSHA256(leadPhone.replace(/\D/g, ""))];
    if (clientDocument) userData.external_id = [hashSHA256(String(clientDocument).replace(/\D/g, ""))];
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;

    const payload = {
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: "https://topmixbrasil.com.br/sucesso",
        user_data: userData,
        custom_data: {
          currency: "BRL",
          value: Number(value) || 0,
          content_type: "product",
          content_name: "Kit Álbum Copa Do Mundo 2026",
        },
      }],
    };

    try {
      const capiRes = await httpsPost(
        "https://graph.facebook.com/v19.0/" + fbPixelId + "/events?access_token=" + fbAccessToken,
        payload,
        {}
      );
      console.log("Meta CAPI response:", JSON.stringify(capiRes.body));
    } catch (err) {
      console.error("Erro ao enviar evento para Meta CAPI:", err.message);
    }
  } else {
    console.warn("FB_ACCESS_TOKEN não configurado — evento Purchase não enviado ao Facebook.");
  }

  // ── Atualiza status do lead no Supabase para "pago" ──
  if (supabaseUrl && supabaseServiceKey && transactionId) {
    try {
      await supabasePatch(
        supabaseUrl,
        supabaseServiceKey,
        "leads",
        "transaction_id=eq." + encodeURIComponent(transactionId),
        { status: "pago" }
      );
    } catch (err) {
      console.error("Erro ao atualizar status no Supabase:", err.message);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
};
