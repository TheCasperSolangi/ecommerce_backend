const crypto = require('crypto');
const InAppNotification = require('../models/in_app_notifications');

const generateNotificationCode = () =>
  `NTF-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Persist an in-app notification for a customer.
 * Best-effort — logs errors, never throws.
 */
const createInAppNotification = async ({
  userId,
  title,
  description,
  type = 'ORDER',
  orderCode = null,
  orderId = null,
  event = null,
}) => {
  if (!userId || !title || !description) return null;

  try {
    return await InAppNotification.create({
      notification_code: generateNotificationCode(),
      user_id: String(userId),
      title,
      description,
      is_read: false,
      type,
      order_code: orderCode || null,
      order_id: orderId ? String(orderId) : null,
      event: event || null,
    });
  } catch (err) {
    console.error('[InApp notify] Failed to create notification:', err.message);
    return null;
  }
};

module.exports = { createInAppNotification, generateNotificationCode };
