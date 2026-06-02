exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let notification;
  try {
    notification = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido." }) };
  }

  const { transactionId, status, transactionType, clientName, clientDocument, value } = notification;

  // Ignora notificações que não são de depósito PIX confirmado
  if (transactionType !== "DEPOSITO" || status !== "COMPLETO") {
    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
  }

  // ── Aqui você pode adicionar ações após confirmação do pagamento: ──
  // Ex: enviar e-mail de confirmação, registrar pedido num banco de dados, etc.
  // Por enquanto, apenas registramos o recebimento nos logs do Netlify.
  console.log(JSON.stringify({
    event: "PIX_PAGO",
    transactionId,
    clientName,
    clientDocument,
    value,
    confirmedAt: new Date().toISOString(),
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ received: true }),
  };
};
