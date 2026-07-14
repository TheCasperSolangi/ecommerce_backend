const admin = require('firebase-admin');

let initialized = false;

/**
 * Lazily initializes the Firebase Admin SDK once.
 * Reads credentials from the FIREBASE_SERVICE_ACCOUNT env variable, which
 * should contain the full service-account JSON as a base64-encoded string.
 *
 * Set it with:
 *   FIREBASE_SERVICE_ACCOUNT=<base64 of your serviceAccountKey.json>
 */
const getApp = () => {
  if (initialized) return admin;

  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!encoded) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
  }

  const serviceAccount = JSON.parse(
    Buffer.from(encoded, 'base64').toString('utf8')
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;
  return admin;
};

/**
 * Sends a push notification to a single FCM/APN token.
 *
 * @param {string} token   - Device push token
 * @param {string} title   - Notification title
 * @param {string} body    - Notification body
 * @param {object} data    - Optional key-value payload (strings only)
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
const sendPushToToken = async (token, title, body, data = {}) => {
  try {
    const app = getApp();
    const messageId = await app.messaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    });
    return { success: true, messageId };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

/**
 * Sends a push notification to multiple tokens in batches of 500
 * (Firebase multicast limit).
 *
 * @param {string[]} tokens
 * @param {string}   title
 * @param {string}   body
 * @param {object}   data
 * @returns {{ delivered: number, failed: number, errors: string[] }}
 */
const sendPushToMany = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return { delivered: 0, failed: 0, errors: [] };

  const app = getApp();
  const BATCH = 500;
  let delivered = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    try {
      const response = await app.messaging().sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
      });
      delivered += response.successCount;
      failed += response.failureCount;
      response.responses.forEach((r) => {
        if (!r.success) errors.push(r.error?.message || 'unknown');
      });
    } catch (err) {
      failed += batch.length;
      errors.push(err.message);
    }
  }

  return { delivered, failed, errors };
};

module.exports = { sendPushToToken, sendPushToMany };
