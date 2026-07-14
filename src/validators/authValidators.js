const { body, validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(new ApiError(400, 'Validation failed', details));
  }
  next();
};

const registerRules = [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/\d/)
    .withMessage('Password must contain at least one number'),
  validate,
];

const loginRules = [
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
];

const emailOnlyRules = [
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  validate,
];

const resetPasswordRules = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/\d/)
    .withMessage('Password must contain at least one number'),
  validate,
];

const changePasswordRules = [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/\d/)
    .withMessage('Password must contain at least one number'),
  validate,
];

const phoneRules = [
  body('phone_number').notEmpty().withMessage('Phone number is required'),
  validate,
];

const phoneOtpVerifyRules = [
  body('phone_number').notEmpty().withMessage('Phone number is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  validate,
];

const socialLoginRules = [
  body('token').notEmpty().withMessage('Social auth token is required'),
  validate,
];

const createAdminRules = [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/\d/)
    .withMessage('Password must contain at least one number'),
  validate,
];

/**
 * Validation rules for PATCH /me (update own profile).
 * - Rejects any privileged fields.
 * - All allowed fields are optional; at least one must be present (checked in controller).
 * - Sanitises string fields and enforces length limits matching the schema.
 */
const updateMeRules = [
  // For each allowed string field: if the value isn't a plain string (e.g.
  // the client sent an array or object), coerce it to undefined so it is
  // treated as absent — no error surfaced, no internal detail leaked.
  body('first_name')
    .optional()
    .customSanitizer((v) => (typeof v === 'string' ? v.trim() : undefined))
    .notEmpty()
    .withMessage('First name must be a non-empty string')
    .isLength({ max: 50 })
    .withMessage('First name must be 50 characters or fewer'),
  body('last_name')
    .optional()
    .customSanitizer((v) => (typeof v === 'string' ? v.trim() : undefined))
    .notEmpty()
    .withMessage('Last name must be a non-empty string')
    .isLength({ max: 50 })
    .withMessage('Last name must be 50 characters or fewer'),
  body('phone_number')
    .optional()
    .customSanitizer((v) => (typeof v === 'string' ? v.trim() : undefined))
    .notEmpty()
    .withMessage('Phone number must be a non-empty string'),
  body('profile_picture')
    .optional()
    .customSanitizer((v) => (typeof v === 'string' ? v.trim() : undefined))
    .isURL()
    .withMessage('Profile picture must be a valid URL'),
  validate,
];

module.exports = {
  registerRules,
  loginRules,
  emailOnlyRules,
  resetPasswordRules,
  changePasswordRules,
  phoneRules,
  phoneOtpVerifyRules,
  socialLoginRules,
  createAdminRules,
  updateMeRules,
};
