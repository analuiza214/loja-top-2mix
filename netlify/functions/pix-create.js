const https = require("https");

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
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const clientId = process.env.MISTICPAY_CLIENT_ID;
  const clientSecret = process.env.MISTICPAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Gateway de pagamento não configurado." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido." }) };
  }

  const { amount, name, document, productName } = body;

  if (!amount || !name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Campos obrigatórios não informados." }),
    };
  }

  const transactionId = `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const siteUrl = process.env.URL || process.env.DEPLOY_URL || "";
  const webhookUrl = siteUrl ? `${siteUrl}/.netlify/functions/pix-webhook` : undefined;

  const payload = {
    amount: Number(amount),
    payerName: name,
    payerDocument: document ? String(document).replace(/\D/g, "") : "00000000000",
    transactionId,
    description:
      productName ||
      "Kit Álbum Copa Do Mundo 2026 Capa Mole + 250 Figurinhas Panini",
    ...(webhookUrl ? { projectWebhook: webhookUrl } : {}),
  };

  try {
    const result = await httpsPost(
      "https://api.misticpay.com/api/transactions/create",
      payload,
      {
        ci: clientId,
        cs: clientSecret,
      }
    );

    if (result.status < 200 || result.status >= 300) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Erro ao gerar PIX. Tente novamente.",
          details: result.body,
        }),
      };
    }

    const data = result.body.data;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: data.transactionId,
        status: data.transactionState,
        pixCode: data.copyPaste,
        qrCodeBase64: data.qrCodeBase64,
        qrCodeImage: data.qrcodeUrl,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Erro de comunicação com o gateway de pagamento.",
      }),
    };
  }
};
