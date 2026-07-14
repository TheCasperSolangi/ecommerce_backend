const crypto = require('crypto');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const sendEmail = require('../utils/sendEmail');       // Resend
const sendWhatsApp = require('../utils/sendSms');      // Twilio WhatsApp (aliased for clarity)
const { verifyGoogleToken, verifyFacebookToken } = require('../utils/socialVerify');
const {
  signAccessToken,
  signRefreshToken,
  hashToken,
  refreshCookieOptions,
} = require('../utils/tokens');

const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const LOCK_MINUTES = Number(process.env.ACCOUNT_LOCK_MINUTES || 30);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Issues an access + refresh token pair, persists the hashed refresh token,
 *  sets the refresh token as an httpOnly cookie, and returns the access token. */
const issueTokens = async (user, res) => {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  user.refresh_tokens = (user.refresh_tokens || []).filter(
    (rt) => rt.expires_at > new Date()
  );
  user.refresh_tokens.push({
    token_hash: hashToken(refreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  await user.save({ validateBeforeSave: false });

  res.cookie('refresh_token', refreshToken, refreshCookieOptions());
  return accessToken;
};

const sanitizeAndRespond = (res, statusCode, user, accessToken, message) => {
  res.status(statusCode).json({
    success: true,
    message,
    data: {
      user: user.toSafeJSON(),
      access_token: accessToken,
    },
  });
};

// ---------------------------------------------------------------------------
// Email + Password
// ---------------------------------------------------------------------------

exports.register = catchAsync(async (req, res) => {
  // Destructure only the fields a user is allowed to supply at registration.
  // Any attempt to set privileged fields (reward_points, wallet_balance,
  // user_role, reward_balance) is silently ignored — they are never read from
  // req.body here, so even if the client sends them they have no effect.
  const { first_name, last_name, email, password, phone_number } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const user = new User({
    first_name,
    last_name,
    email,
    password,
    phone_number: phone_number || null,
    auth_providers: ['local'],
    // user_role, wallet_balance, reward_points intentionally omitted —
    // schema defaults apply (role: 'user', balances: 0).
  });

  const rawToken = user.generateEmailVerificationToken();
  await user.save();

  const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${rawToken}`;
  try {
    await sendEmail({
      to: user.email,
      subject: 'Verify your email address',
      html: `<p>Hi ${user.first_name},</p><p>Please verify your email by clicking the link below. This link expires in ${process.env.EMAIL_TOKEN_EXPIRES_MIN || 30} minutes.</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });
  } catch (err) {
    // Registration should still succeed even if the email fails to send;
    // the user can request a new verification email.
    console.error('Failed to send verification email:', err.message);
  }

  const accessToken = await issueTokens(user, res);
  sanitizeAndRespond(res, 201, user, accessToken, 'Account created. Please check your email to verify your address.');
});

exports.verifyEmail = catchAsync(async (req, res) => {
  const { token } = req.body;
  if (!token) throw new ApiError(400, 'Verification token is required');

  const hashed = hashToken(token);
  const user = await User.findOne({
    email_verification_token: hashed,
    email_verification_expires: { $gt: new Date() },
  }).select('+email_verification_token +email_verification_expires');

  if (!user) throw new ApiError(400, 'Verification link is invalid or has expired');

  user.is_email_verified = true;
  user.email_verification_token = undefined;
  user.email_verification_expires = undefined;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({ success: true, message: 'Email verified successfully' });
});

exports.resendVerificationEmail = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Avoid leaking account existence
  if (!user || user.is_email_verified) {
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists and is unverified, a new link has been sent.',
    });
  }

  const rawToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your email address',
    html: `<p>Please verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
  });

  res.status(200).json({
    success: true,
    message: 'If an account with that email exists and is unverified, a new link has been sent.',
  });
});

exports.login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password +account_locked_until');
  if (!user || !user.password) {
    throw new ApiError(401, 'Invalid email or password');
  }

  if (user.is_account_locked) {
    if (user.account_locked_until && user.account_locked_until > new Date()) {
      const minutesLeft = Math.ceil((user.account_locked_until - Date.now()) / 60000);
      throw new ApiError(403, `Account is locked. Try again in ${minutesLeft} minute(s).`);
    }
    // Lock period has expired - reset it
    user.is_account_locked = false;
    user.login_attempts = 0;
    user.account_locked_until = undefined;
  }

  if (user.status !== 'active') {
    throw new ApiError(403, `Your account is ${user.status}. Please contact support.`);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    user.login_attempts += 1;

    if (user.login_attempts >= MAX_LOGIN_ATTEMPTS) {
      // Lock the account on the 5th (or more) consecutive failed attempt.
      user.is_account_locked = true;
      user.account_locked_until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      await user.save({ validateBeforeSave: false });
      throw new ApiError(
        403,
        `Too many failed attempts. Your account has been locked for ${LOCK_MINUTES} minute(s).`
      );
    }

    const attemptsLeft = MAX_LOGIN_ATTEMPTS - user.login_attempts;
    await user.save({ validateBeforeSave: false });
    throw new ApiError(
      401,
      `Invalid email or password. ${attemptsLeft} attempt(s) remaining before your account is locked.`
    );
  }

  user.login_attempts = 0;
  user.is_account_locked = false;
  user.account_locked_until = undefined;
  user.last_login = new Date();

  const accessToken = await issueTokens(user, res);
  sanitizeAndRespond(res, 200, user, accessToken, 'Login successful');
});

// ---------------------------------------------------------------------------
// Passwordless authentication (magic link via email)
// ---------------------------------------------------------------------------

exports.requestPasswordlessLogin = catchAsync(async (req, res) => {
  const { email } = req.body;
  let user = await User.findOne({ email });

  if (!user) {
    // Auto-provision a minimal account for passwordless-first sign-in
    user = new User({
      first_name: 'New',
      last_name: 'User',
      email,
      auth_providers: ['local'],
    });
  }

  const rawToken = user.generatePasswordlessToken();
  await user.save({ validateBeforeSave: false });

  const loginUrl = `${process.env.CLIENT_URL}/passwordless-login?token=${rawToken}&email=${encodeURIComponent(email)}`;
  await sendEmail({
    to: email,
    subject: 'Your login link',
    html: `<p>Click the link below to log in. This link expires in ${process.env.EMAIL_TOKEN_EXPIRES_MIN || 30} minutes and can only be used once.</p><p><a href="${loginUrl}">${loginUrl}</a></p>`,
  });

  res.status(200).json({
    success: true,
    message: 'A login link has been sent to your email.',
  });
});

exports.verifyPasswordlessLogin = catchAsync(async (req, res) => {
  const { token, email } = req.body;
  if (!token || !email) throw new ApiError(400, 'Token and email are required');

  const hashed = hashToken(token);
  const user = await User.findOne({
    email,
    passwordless_login_token: hashed,
    passwordless_login_expires: { $gt: new Date() },
  }).select('+passwordless_login_token +passwordless_login_expires');

  if (!user) throw new ApiError(400, 'Login link is invalid or has expired');

  if (user.status !== 'active') {
    throw new ApiError(403, `Your account is ${user.status}. Please contact support.`);
  }

  user.passwordless_login_token = undefined;
  user.passwordless_login_expires = undefined;
  user.is_email_verified = true; // clicking an emailed link proves ownership
  user.last_login = new Date();
  user.login_attempts = 0;

  const accessToken = await issueTokens(user, res);
  sanitizeAndRespond(res, 200, user, accessToken, 'Login successful');
});

// ---------------------------------------------------------------------------
// Phone OTP (can be used standalone or to verify a phone number)
// ---------------------------------------------------------------------------

exports.requestPhoneOtp = catchAsync(async (req, res) => {
  const { phone_number } = req.body;

  let user = req.user; // if authenticated, attach OTP to logged-in user
  if (!user) {
    user = await User.findOne({ phone_number });
    if (!user) throw new ApiError(404, 'No account found with this phone number');
  }

  const otp = user.generatePhoneOtp();
  if (phone_number) user.phone_number = phone_number;
  await user.save({ validateBeforeSave: false });

  await sendWhatsApp({
    to: user.phone_number,
    message: `Your verification code is *${otp}*. It expires in ${process.env.OTP_EXPIRES_MIN || 10} minutes. Do not share this code with anyone.`,
  });

  res.status(200).json({ success: true, message: 'OTP sent via WhatsApp' });
});

exports.verifyPhoneOtp = catchAsync(async (req, res) => {
  const { phone_number, otp } = req.body;

  const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
  const user = await User.findOne({
    phone_number,
    phone_verification_otp: hashedOtp,
    otp_expires_in: { $gt: new Date() },
  }).select('+phone_verification_otp +otp_expires_in');

  if (!user) throw new ApiError(400, 'OTP is invalid or has expired');

  user.is_phone_verified = true;
  user.phone_verification_otp = undefined;
  user.otp_expires_in = undefined;
  user.last_login = new Date();

  const accessToken = await issueTokens(user, res);
  sanitizeAndRespond(res, 200, user, accessToken, 'Phone verified and logged in successfully');
});

// ---------------------------------------------------------------------------
// Password reset / change
// ---------------------------------------------------------------------------

exports.forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  }

  const rawToken = user.generatePasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your password',
    html: `<p>You requested a password reset. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
  });

  res.status(200).json({
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent.',
  });
});

exports.resetPassword = catchAsync(async (req, res) => {
  const { token, password } = req.body;
  const hashed = hashToken(token);

  const user = await User.findOne({
    password_reset_token: hashed,
    password_reset_expires: { $gt: new Date() },
  }).select('+password_reset_token +password_reset_expires');

  if (!user) throw new ApiError(400, 'Reset link is invalid or has expired');

  user.password = password;
  user.password_reset_token = undefined;
  user.password_reset_expires = undefined;
  user.login_attempts = 0;
  user.is_account_locked = false;
  user.account_locked_until = undefined;
  user.refresh_tokens = []; // force re-login everywhere
  await user.save();

  res.status(200).json({ success: true, message: 'Password reset successfully. Please log in.' });
});

exports.changePassword = catchAsync(async (req, res) => {
  const { current_password, new_password } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  if (user.password) {
    const isMatch = await user.comparePassword(current_password);
    if (!isMatch) throw new ApiError(401, 'Current password is incorrect');
  }

  user.password = new_password;
  await user.save();

  res.status(200).json({ success: true, message: 'Password changed successfully' });
});

// ---------------------------------------------------------------------------
// Social login (Google / Facebook) - client sends a verified provider token
// ---------------------------------------------------------------------------

const findOrCreateSocialUser = async ({ provider, profile }) => {
  const idField = provider === 'google' ? 'google_id' : 'facebook_id';

  let user = await User.findOne({ [idField]: profile.provider_id });
  if (user) return user;

  // Link to an existing email-based account if one exists
  if (profile.email) {
    user = await User.findOne({ email: profile.email });
    if (user) {
      user[idField] = profile.provider_id;
      if (!user.auth_providers.includes(provider)) user.auth_providers.push(provider);
      if (!user.profile_picture && profile.profile_picture) {
        user.profile_picture = profile.profile_picture;
      }
      await user.save({ validateBeforeSave: false });
      return user;
    }
  }

  user = new User({
    first_name: profile.first_name || 'User',
    last_name: profile.last_name || '',
    email: profile.email || `${profile.provider_id}@${provider}.placeholder`,
    profile_picture: profile.profile_picture,
    is_email_verified: Boolean(profile.email_verified),
    auth_providers: [provider],
    [idField]: profile.provider_id,
  });
  await user.save({ validateBeforeSave: false });
  return user;
};

exports.googleLogin = catchAsync(async (req, res) => {
  const { token } = req.body; // Google ID token from client SDK
  const profile = await verifyGoogleToken(token);
  const user = await findOrCreateSocialUser({ provider: 'google', profile });

  if (user.status !== 'active') {
    throw new ApiError(403, `Your account is ${user.status}. Please contact support.`);
  }

  user.last_login = new Date();
  const accessToken = await issueTokens(user, res);
  sanitizeAndRespond(res, 200, user, accessToken, 'Login successful');
});

exports.facebookLogin = catchAsync(async (req, res) => {
  const { token } = req.body; // Facebook access token from client SDK
  const profile = await verifyFacebookToken(token);
  const user = await findOrCreateSocialUser({ provider: 'facebook', profile });

  if (user.status !== 'active') {
    throw new ApiError(403, `Your account is ${user.status}. Please contact support.`);
  }

  user.last_login = new Date();
  const accessToken = await issueTokens(user, res);
  sanitizeAndRespond(res, 200, user, accessToken, 'Login successful');
});

// ---------------------------------------------------------------------------
// Token refresh / logout / session
// ---------------------------------------------------------------------------

exports.refreshToken = catchAsync(async (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.cookies && req.cookies.refresh_token;
  if (!token) throw new ApiError(401, 'Refresh token missing');

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const user = await User.findById(decoded.sub).select('+refresh_tokens');
  if (!user) throw new ApiError(401, 'User no longer exists');

  const tokenHash = hashToken(token);
  const storedToken = (user.refresh_tokens || []).find((rt) => rt.token_hash === tokenHash);
  if (!storedToken || storedToken.expires_at < new Date()) {
    throw new ApiError(401, 'Refresh token is invalid or has been revoked. Please log in again.');
  }

  // Rotate: remove the used token, issue a new pair
  user.refresh_tokens = user.refresh_tokens.filter((rt) => rt.token_hash !== tokenHash);
  const accessToken = await issueTokens(user, res);

  res.status(200).json({
    success: true,
    data: { access_token: accessToken },
  });
});

exports.logout = catchAsync(async (req, res) => {
  const token = req.cookies && req.cookies.refresh_token;
  if (token && req.user) {
    const tokenHash = hashToken(token);
    req.user.refresh_tokens = (req.user.refresh_tokens || []).filter(
      (rt) => rt.token_hash !== tokenHash
    );
    await req.user.save({ validateBeforeSave: false });
  }
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

exports.logoutAll = catchAsync(async (req, res) => {
  req.user.refresh_tokens = [];
  await req.user.save({ validateBeforeSave: false });
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.status(200).json({ success: true, message: 'Logged out from all devices' });
});

exports.getMe = catchAsync(async (req, res) => {
  res.status(200).json({ success: true, data: { user: req.user.toSafeJSON() } });
});

// ---------------------------------------------------------------------------
// Update own profile
// ---------------------------------------------------------------------------

exports.updateMe = catchAsync(async (req, res) => {
  // Silently whitelist only the fields a user may change.
  // Privileged fields (user_role, wallet_balance, reward_points, etc.) are
  // never read from req.body — no error is surfaced to avoid leaking which
  // fields are protected.
  const ALLOWED_FIELDS = [
    'first_name',
    'last_name',
    'phone_number',
    'profile_picture',
  ];

  const updates = {};
  ALLOWED_FIELDS.forEach((field) => {
    // Only include the field if it is present AND was not sanitized away
    // (customSanitizer converts non-string values to undefined).
    if (field in req.body && req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'No updatable fields provided');
  }

  // Apply updates directly on the fetched user document so that Mongoose
  // validators still run (e.g. maxlength on first_name / last_name).
  const user = await User.findById(req.user._id);
  if (!user) throw new ApiError(404, 'User not found');

  Object.assign(user, updates);
  await user.save({ validateBeforeSave: true });

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: user.toSafeJSON() },
  });
});

// ---------------------------------------------------------------------------
// Admin - create additional admin accounts
// ---------------------------------------------------------------------------

exports.createAdmin = catchAsync(async (req, res) => {
  const { first_name, last_name, email, password } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'An account with this email already exists');

  const admin = new User({
    first_name,
    last_name,
    email,
    password,
    user_role: 'admin',
    is_email_verified: true, // created by a trusted admin
    auth_providers: ['local'],
  });
  await admin.save();

  res.status(201).json({
    success: true,
    message: 'Admin account created successfully',
    data: { user: admin.toSafeJSON() },
  });
});
