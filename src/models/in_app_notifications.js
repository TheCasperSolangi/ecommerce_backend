const mongoose = require('mongoose');

/**
 * In-app notifications for customers (polled by the storefront).
 * Populated whenever an order is placed / status-updated.
 */
const inAppNotificationSchema = new mongoose.Schema(
  {
    notification_code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    is_read: {
      type: Boolean,
      default: false,
      index: true,
    },
    /** Source of the notification */
    type: {
      type: String,
      enum: ['ORDER', 'PAYMENT', 'SYSTEM', 'MARKETING'],
      default: 'ORDER',
    },
    /** Optional order linkage */
    order_code: {
      type: String,
      default: null,
    },
    order_id: {
      type: String,
      default: null,
    },
    /** Order / payment event key e.g. CONFIRMED, DELIVERED */
    event: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

inAppNotificationSchema.index({ user_id: 1, created_at: -1 });
inAppNotificationSchema.index({ user_id: 1, is_read: 1 });

module.exports = mongoose.model('InAppNotifications', inAppNotificationSchema);
