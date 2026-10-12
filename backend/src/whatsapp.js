// Thin wrapper around Meta's WhatsApp Cloud API (Graph API).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const {
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_API_VERSION = "v20.0",
  WHATSAPP_TASK_TEMPLATE_NAME = "task_assignment",
  WHATSAPP_TASK_TEMPLATE_LANG = "en",
} = process.env;

const GRAPH_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

function assertConfigured() {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    throw new Error(
      "WhatsApp is not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env"
    );
  }
}

async function callGraphApi(body) {
  assertConfigured();
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || "WhatsApp API request failed";
    throw new Error(msg);
  }
  return data;
}

/**
 * Sends a task-assignment message using a pre-approved WhatsApp template.
 * You must create and get this template approved in Meta Business Manager first
 * (Business Settings > WhatsApp Accounts > Message Templates).
 *
 * Suggested template body (submit for approval, category UTILITY):
 *   "Hi {{1}}, you've been assigned a new task: *{{2}}*.
 *    Category: {{3}}. Due: {{4}}.
 *    Reply *1* when you start, *2* when it's done."
 */
export async function sendTaskMessage({ toPhone, staffName, title, category, dueDateLabel }) {
  return callGraphApi({
    messaging_product: "whatsapp",
    to: toPhone.replace(/[^\d+]/g, ""),
    type: "template",
    template: {
      name: WHATSAPP_TASK_TEMPLATE_NAME,
      language: { code: WHATSAPP_TASK_TEMPLATE_LANG },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: staffName },
            { type: "text", text: title },
            { type: "text", text: category },
            { type: "text", text: dueDateLabel || "no due time set" },
          ],
        },
      ],
    },
  });
}

/** Plain text message — only deliverable within Meta's 24h "customer service window"
 *  after the staff member has messaged in, e.g. as a status-change confirmation reply. */
export async function sendTextMessage({ toPhone, text }) {
  return callGraphApi({
    messaging_product: "whatsapp",
    to: toPhone.replace(/[^\d+]/g, ""),
    type: "text",
    text: { body: text },
  });
}

/**
 * Parses an incoming webhook payload from Meta into a normalized shape.
 * Returns null if the payload isn't a message we care about (e.g. a status callback).
 */
export function parseInboundMessage(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return null;

    const fromPhone = "+" + message.from; // Meta sends without leading '+'
    let text = "";
    if (message.type === "text") text = message.text.body.trim();
    if (message.type === "button") text = message.button.text.trim();
    if (message.type === "interactive") {
      text =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "";
    }
    return { fromPhone, text, raw: message };
  } catch {
    return null;
  }
}
