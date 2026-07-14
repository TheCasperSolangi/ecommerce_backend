const crypto = require('crypto');
const MarketingMessage = require('../models/marketing');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendPushToMany } = require('../utils/pushNotification');
const { sendWhatsAppToMany } = require('../utils/whatsapp');
const { sendMarketingEmailToMany } = require('../utils/marketingEmail');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CHANNELS = ['Whatsapp', 'Email', 'Push Notifications'];

const generateMessageCode = () =>
  `MKT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Builds a simple HTML email body from the message text and optional image.
 * Keeps it minimal — marketers can extend the template later.
 */
const buildEmailHtml = (text, imageUrl) => `
<!DOCTYPE html>
<html>
  <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
    ${imageUrl ? `<img src="${imageUrl}" alt="promotion" style="width:100%;border-radius:8px;margin-bottom:16px;" />` : ''}
    <p style="font-size:16px;line-height:1.6;color:#333;">${text}</p>
  </body>
</html>`;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** GET /api/marketing
 *  List all campaigns with pagination and optional channel/status filter. */
exports.getAllMessages = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const filter = {};
  if (search) filter.$or = [
    { message_code: { $regex: search, $options: 'i' } },
    { text: { $regex: search, $options: 'i' } },
  ];

  const skip = (Number(page) - 1) * Number(limit);
  const [messages, total] = await Promise.all([
    MarketingMessage.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)),
    MarketingMessage.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      messages,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/marketing/:id */
exports.getMessage = catchAsync(async (req, res) => {
  const message = await MarketingMessage.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Marketing message not found');
  res.status(200).json({ success: true, data: { message } });
});

/** POST /api/marketing
 *  Create a new campaign message (does NOT send yet).
 *  Body: { text, image?, channels: ['Whatsapp', 'Email', 'Push Notifications'] } */
exports.createMessage = catchAsync(async (req, res) => {
  const { text, image, channels } = req.body;

  if (!text) throw new ApiError(400, 'text is required');
  if (!channels || !Array.isArray(channels) || channels.length === 0) {
    throw new ApiError(400, 'channels must be a non-empty array');
  }

  const invalidChannels = channels.filter((c) => !VALID_CHANNELS.includes(c));
  if (invalidChannels.length > 0) {
    throw new ApiError(
      400,
      `Invalid channel(s): ${invalidChannels.join(', ')}. Valid values: ${VALID_CHANNELS.join(', ')}`
    );
  }

  const message = await MarketingMessage.create({
    message_code: generateMessageCode(),
    text,
    image: image || null,
    channels,
    analytics: { delivered: 0, clicked: 0, failed: 0 },
  });

  res.status(201).json({
    success: true,
    message: 'Marketing message created successfully',
    data: { message },
  });
});

/** PATCH /api/marketing/:id
 *  Update text/image/channels — only allowed before the campaign has been sent. */
exports.updateMessage = catchAsync(async (req, res) => {
  const { text, image, channels } = req.body;

  if (channels) {
    const invalid = channels.filter((c) => !VALID_CHANNELS.includes(c));
    if (invalid.length > 0) {
      throw new ApiError(400, `Invalid channel(s): ${invalid.join(', ')}`);
    }
  }

  const updates = {};
  if (text !== undefined) updates.text = text;
  if (image !== undefined) updates.image = image;
  if (channels !== undefined) updates.channels = channels;

  const message = await MarketingMessage.findByIdAndUpdate(
    req.params.id,
    updates,
    { new: true, runValidators: true }
  );
  if (!message) throw new ApiError(404, 'Marketing message not found');

  res.status(200).json({
    success: true,
    message: 'Marketing message updated successfully',
    data: { message },
  });
});

/** DELETE /api/marketing/:id */
exports.deleteMessage = catchAsync(async (req, res) => {
  const message = await MarketingMessage.findByIdAndDelete(req.params.id);
  if (!message) throw new ApiError(404, 'Marketing message not found');
  res.status(200).json({ success: true, message: 'Marketing message deleted successfully' });
});

// ---------------------------------------------------------------------------
// Send / Broadcast
// ---------------------------------------------------------------------------

/**
 * POST /api/marketing/:id/send
 *
 * Broadcasts the campaign to users according to channel rules:
 *
 *  ── Push Notifications ────────────────────────────────────────────────────
 *   Sent to ALL active users that have at least one push token,
 *   regardless of is_marketing_accepted.
 *
 *  ── WhatsApp ──────────────────────────────────────────────────────────────
 *   Sent ONLY to users where:
 *     is_marketing_accepted: true  AND  is_phone_verified: true
 *
 *  ── Email ─────────────────────────────────────────────────────────────────
 *   Sent ONLY to users where:
 *     is_marketing_accepted: true  AND  is_email_verified: true
 *
 * Body (optional): { subject }  — email subject line, defaults to message text excerpt.
 */
exports.sendMessage = catchAsync(async (req, res) => {
  const campaign = await MarketingMessage.findById(req.params.id);
  if (!campaign) throw new ApiError(404, 'Marketing message not found');

  const channels  = campaign.channels || [];
  const { subject } = req.body;

  // Aggregate analytics across all channels.
  let totalDelivered = 0;
  let totalFailed    = 0;
  const channelResults = {};

  // ── 1. Push Notifications ───────────────────────────────────────────────
  if (channels.includes('Push Notifications')) {
    // Fetch ALL active users that have push tokens — no marketing opt-in check.
    const usersWithTokens = await User.find({
      status: 'active',
      'push_tokens.0': { $exists: true }, // at least one token
    }).select('push_tokens');

    // Flatten all tokens across all users.
    const allTokens = usersWithTokens.flatMap((u) =>
      (u.push_tokens || []).map((t) => t.token).filter(Boolean)
    );

    if (allTokens.length > 0) {
      const pushResult = await sendPushToMany(
        allTokens,
        'New message',   // title — kept generic; customise as needed
        campaign.text,
        campaign.image ? { image: campaign.image } : {}
      );
      totalDelivered += pushResult.delivered;
      totalFailed    += pushResult.failed;
      channelResults['Push Notifications'] = pushResult;
    } else {
      channelResults['Push Notifications'] = { delivered: 0, failed: 0, errors: ['No registered push tokens'] };
    }
  }

  // ── 2. WhatsApp ─────────────────────────────────────────────────────────
  if (channels.includes('Whatsapp')) {
    // Only opted-in + phone-verified users.
    const eligible = await User.find({
      status: 'active',
      is_marketing_accepted: true,
      is_phone_verified: true,
      phone_number: { $ne: null },
    }).select('phone_number');

    const phones = eligible.map((u) => u.phone_number).filter(Boolean);

    if (phones.length > 0) {
      const waResult = await sendWhatsAppToMany(
        phones,
        campaign.text,
        campaign.image || undefined
      );
      totalDelivered += waResult.delivered;
      totalFailed    += waResult.failed;
      channelResults['Whatsapp'] = waResult;
    } else {
      channelResults['Whatsapp'] = { delivered: 0, failed: 0, errors: ['No eligible users'] };
    }
  }

  // ── 3. Email ────────────────────────────────────────────────────────────
  if (channels.includes('Email')) {
    // Only opted-in + email-verified users.
    const eligible = await User.find({
      status: 'active',
      is_marketing_accepted: true,
      is_email_verified: true,
    }).select('email');

    const emails = eligible.map((u) => u.email).filter(Boolean);

    if (emails.length > 0) {
      const emailSubject = subject || campaign.text.substring(0, 60);
      const html = buildEmailHtml(campaign.text, campaign.image);

      const emailResult = await sendMarketingEmailToMany(emails, emailSubject, html);
      totalDelivered += emailResult.delivered;
      totalFailed    += emailResult.failed;
      channelResults['Email'] = emailResult;
    } else {
      channelResults['Email'] = { delivered: 0, failed: 0, errors: ['No eligible users'] };
    }
  }

  // ── Update analytics on the campaign document ───────────────────────────
  campaign.analytics.delivered = (campaign.analytics.delivered || 0) + totalDelivered;
  campaign.analytics.failed    = (campaign.analytics.failed    || 0) + totalFailed;
  await campaign.save();

  res.status(200).json({
    success: true,
    message: 'Campaign dispatched',
    data: {
      campaign_id: campaign._id,
      message_code: campaign.message_code,
      channels_used: channels,
      summary: {
        total_delivered: totalDelivered,
        total_failed: totalFailed,
      },
      channel_breakdown: channelResults,
    },
  });
});

// ---------------------------------------------------------------------------
// Analytics — record a click (called from frontend tracking pixel / deeplink)
// ---------------------------------------------------------------------------

/** POST /api/marketing/:id/track-click
 *  Increments the clicked counter. No auth required — called by the client. */
exports.trackClick = catchAsync(async (req, res) => {
  await MarketingMessage.findByIdAndUpdate(req.params.id, {
    $inc: { 'analytics.clicked': 1 },
  });
  // Return a 1x1 transparent GIF so this can double as an email tracking pixel.
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  res.set('Content-Type', 'image/gif');
  res.send(pixel);
});
