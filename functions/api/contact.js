const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const clean = (value, maxLength) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);

export async function onRequestPost({ request, env }) {
  console.info("Mistho contact function invoked", {
    method: request.method,
    path: new URL(request.url).pathname,
  });

  const origin = request.headers.get("Origin");
  if (origin && new URL(request.url).origin !== origin) {
    return json({ error: "Ongeldige aanvraag." }, 403);
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json({ error: "Ongeldige formuliergegevens." }, 400);
  }

  if (raw.length > 12000) {
    return json({ error: "De aanvraag is te groot." }, 413);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return json({ error: "Ongeldige formuliergegevens." }, 400);
  }

  if (clean(data.website, 200)) {
    return json({ success: true });
  }

  const name = clean(data.name, 120);
  const company = clean(data.company, 160);
  const email = clean(data.email, 254).toLowerCase();
  const phone = clean(data.phone, 50);
  const topic = clean(data.topic, 120);
  const message = clean(data.message, 5000);

  if (
    !name ||
    !topic ||
    !message ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return json({ error: "Controleer uw gegevens." }, 400);
  }

  const resendApiKey = String(env.RESEND_API_KEY || "").trim();
  if (!resendApiKey) {
    console.error("Contact form configuration missing", {
      resendApiKeyConfigured: false,
    });
    return json({ error: "Het formulier is nog niet ingesteld." }, 503);
  }

  const text = [
    "Nieuwe aanvraag via de website van Mistho",
    "",
    "Naam: " + name,
    "Bedrijf: " + (company || "Niet ingevuld"),
    "E-mail: " + email,
    "Telefoon: " + (phone || "Niet ingevuld"),
    "Onderwerp: " + topic,
    "",
    "Project:",
    message,
  ].join("\n");

  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Mistho website <website@mail.misthoprojects.com>",
        to: ["info@misthoprojects.com"],
        reply_to: email,
        subject: "Nieuwe websiteaanvraag: " + topic,
        text,
      }),
    });
  } catch (error) {
    console.error("Resend request failed", {
      name: error?.name || "Error",
      message: String(error?.message || "").slice(0, 300),
    });
    return json(
      { error: "Versturen lukte niet. Mail naar info@misthoprojects.com." },
      502,
    );
  }

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    console.error("Resend rejected the contact form", {
      status: response.status,
      name: clean(result?.name, 100),
      message: clean(result?.message, 300),
    });
    return json(
      { error: "Versturen lukte niet. Mail naar info@misthoprojects.com." },
      502,
    );
  }

  console.info("Mistho contact email accepted by Resend", {
    status: response.status,
    id: result.id,
  });
  return json({ success: true });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Methode niet toegestaan." }, 405);
  }
  return onRequestPost(context);
}
