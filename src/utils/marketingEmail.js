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
 * Sends a marketing email to a single recipient via Resend.
 *
 * @param {string}  to      - Recipient email address
 * @param {string}  subject - Email subject
 * @param {string}  html    - HTML body
 * @returns {{ success: boolean, id?: string, error?: string }}
 */
const sendMarketingEmail = async (to, subject, html) => {
  try {
    const from = process.env.RESEND_FROM_EMAIL || 'marketing@yourdomain.com';
    const { data, error } = await getClient().emails.send({ from, to, subject, html });

    if (error) return { success: false, error: error.message || JSON.stringify(error) };
    return { success: true, id: data?.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

/**
 * Sends the same marketing email to many recipients.
 * Resend has a batch API but it requires the "to" array per message;
 * we use it here by batching in groups of 100.
 *
 * @param {string[]} recipients - Array of email addresses
 * @param {string}   subject
 * @param {string}   html
 * @returns {{ delivered: number, failed: number, errors: string[] }}
 */
const sendMarketingEmailToMany = async (recipients, subject, html) => {
  if (!recipients || recipients.length === 0) return { delivered: 0, failed: 0, errors: [] };

  const from    = process.env.RESEND_FROM_EMAIL || 'marketing@yourdomain.com';
  const BATCH   = 100;
  let delivered = 0;
  let failed    = 0;
  const errors  = [];

  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);

    // Build one send-request per recipient so personalisation is possible
    // in the future, and failures are isolated.
    const sends = batch.map((to) =>
      getClient().emails.send({ from, to, subject, html })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message || JSON.stringify(error));
          return data;
        })
    );

    const results = await Promise.allSettled(sends);
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        delivered++;
      } else {
        failed++;
        errors.push(`${batch[idx]}: ${r.reason?.message || 'unknown'}`);
      }
    });
  }

  return { delivered, failed, errors };
};

module.exports = { sendMarketingEmail, sendMarketingEmailToMany };
