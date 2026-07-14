const { Resend } = require('resend');

let resendClient = null;

const getClient = () => {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY environment variable is not set');
  resendClient = new Resend(apiKey);
  return resendClient;
};

/**
 * Sends a transactional email via Resend.
 * Keeps the same call signature as the old nodemailer helper so every
 * existing caller (authController, etc.) works without changes.
 *
 * @param {object} opts
 * @param {string}   opts.to           - Recipient email address
 * @param {string}   opts.subject      - Email subject line
 * @param {string}   opts.html         - HTML body
 * @param {string}   [opts.text]       - Plain-text fallback
 * @param {Array}    [opts.attachments] - [{ filename, content: Buffer, contentType }]
 */
const sendEmail = async ({ to, subject, html, text, attachments }) => {
  const from = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || 'no-reply@yourdomain.com';

  // Resend expects attachment content as a base64 string.
  const resendAttachments = (attachments || []).map((a) => ({
    filename:    a.filename,
    content:     Buffer.isBuffer(a.content)
      ? a.content.toString('base64')
      : a.content,
  }));

  const payload = {
    from,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
    ...(resendAttachments.length > 0 ? { attachments: resendAttachments } : {}),
  };

  const { error } = await getClient().emails.send(payload);

  if (error) {
    throw new Error(`Resend error: ${error.message || JSON.stringify(error)}`);
  }
};

module.exports = sendEmail;
