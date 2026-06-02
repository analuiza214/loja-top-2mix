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
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const transactionId = event.queryStringParameters && event.queryStringParameters.transactionId;
  if (!transactionId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "transactionId obrigatório" }) };
  }

  const clientId = process.env.MISTICPAY_CLIENT_ID;
  const clientSecret = process.env.MISTICPAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Gateway não configurado" }) };
  }

  try {
    const result = await httpsPost(
      "https://api.misticpay.com/api/transactions/check",
      { transactionId },
      {
        ci: clientId,
        cs: clientSecret,
      }
    );

    const body = result.body;
    const transaction = body && body.transaction ? body.transaction : body;
    const rawStatus = ((transaction && transaction.transactionState) || "").toUpperCase();

    const isPaid = rawStatus === "COMPLETO";
    const isExpired = rawStatus === "FALHA";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        transactionId,
        status: rawStatus,
        isPaid,
        isExpired,
        payedAt: (transaction && transaction.updatedAt) || null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Erro ao consultar status do pagamento." }),
    };
  }
};
