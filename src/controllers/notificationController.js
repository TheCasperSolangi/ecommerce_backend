const InAppNotification = require('../models/in_app_notifications');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

/**
 * GET /api/notifications
 * List the authenticated customer's in-app notifications (newest first).
 */
exports.getMyNotifications = catchAsync(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const userId = String(req.user._id);

  const filter = { user_id: userId };

  const [notifications, total, unread_count] = await Promise.all([
    InAppNotification.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v')
      .lean(),
    InAppNotification.countDocuments(filter),
    InAppNotification.countDocuments({ user_id: userId, is_read: false }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      notifications,
      unread_count,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 0,
      },
    },
  });
});

/**
 * GET /api/notifications/unread-count
 * Lightweight endpoint for badge polling.
 */
exports.getUnreadCount = catchAsync(async (req, res) => {
  const unread_count = await InAppNotification.countDocuments({
    user_id: String(req.user._id),
    is_read: false,
  });

  res.status(200).json({
    success: true,
    data: { unread_count },
  });
});

/**
 * PATCH /api/notifications/read-all
 * Mark every notification for the user as read.
 */
exports.markAllRead = catchAsync(async (req, res) => {
  const result = await InAppNotification.updateMany(
    { user_id: String(req.user._id), is_read: false },
    { $set: { is_read: true } }
  );

  res.status(200).json({
    success: true,
    message: 'All notifications marked as read',
    data: { modified: result.modifiedCount ?? result.nModified ?? 0 },
  });
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read (must belong to the user).
 */
exports.markRead = catchAsync(async (req, res) => {
  const notification = await InAppNotification.findOneAndUpdate(
    {
      _id: req.params.id,
      user_id: String(req.user._id),
    },
    { $set: { is_read: true } },
    { new: true }
  ).select('-__v');

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  res.status(200).json({
    success: true,
    data: { notification },
  });
});
