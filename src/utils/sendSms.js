const twilio = require('twilio');

let client = null;

const getClient = () => {
  if (client) return client;
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
  }
  client = twilio(sid, token);
  return client;
};

/**
 * Sends a WhatsApp message via Twilio.
 * Keeps the same call signature as the old SMS stub so authController
 * works without changes.
 *
 * @param {object} opts
 * @param {string}  opts.to      - Recipient phone in E.164 format, e.g. '+923001234567'
 * @param {string}  opts.message - Message body
 */
const sendSms = async ({ to, message }) => {
  const from = `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`;
  const toFormatted = `whatsapp:${to}`;

  await getClient().messages.create({
    from,
    to: toFormatted,
    body: message,
  });
};

module.exports = sendSms;
