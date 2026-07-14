const twilio = require('twilio');

let client = null;

const getClient = () => {
  if (client) return client;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
  }

  client = twilio(accountSid, authToken);
  return client;
};

/**
 * Sends a WhatsApp message via Twilio.
 *
 * @param {string} to      - Recipient phone in E.164 format, e.g. '+12345678901'
 * @param {string} body    - Message text
 * @param {string} [mediaUrl] - Optional public image URL to attach
 * @returns {{ success: boolean, sid?: string, error?: string }}
 */
const sendWhatsApp = async (to, body, mediaUrl) => {
  try {
    const from = `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`;
    const toFormatted = `whatsapp:${to}`;

    const payload = { from, to: toFormatted, body };
    if (mediaUrl) payload.mediaUrl = [mediaUrl];

    const message = await getClient().messages.create(payload);
    return { success: true, sid: message.sid };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

/**
 * Sends the same WhatsApp message to many recipients, one at a time.
 * Returns aggregate counts so the caller can update analytics.
 *
 * @param {string[]} phoneNumbers - Array of E.164 phone numbers
 * @param {string}   body
 * @param {string}   [mediaUrl]
 * @returns {{ delivered: number, failed: number, errors: string[] }}
 */
const sendWhatsAppToMany = async (phoneNumbers, body, mediaUrl) => {
  let delivered = 0;
  let failed = 0;
  const errors = [];

  // Twilio has no native bulk WhatsApp API — fire individually with a
  // small delay to avoid rate-limit errors on large lists.
  for (const phone of phoneNumbers) {
    const result = await sendWhatsApp(phone, body, mediaUrl);
    if (result.success) {
      delivered++;
    } else {
      failed++;
      errors.push(`${phone}: ${result.error}`);
    }
    // Throttle: 10 msg/s is the default Twilio sandbox limit.
    await new Promise((r) => setTimeout(r, 100));
  }

  return { delivered, failed, errors };
};

module.exports = { sendWhatsApp, sendWhatsAppToMany };
