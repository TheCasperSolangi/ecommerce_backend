const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    first_name: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: 50,
    },
    last_name: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: 50,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },

    // Password is optional at the schema level because social-login /
    // passwordless-only users may never set one.
    password: {
      type: String,
      minlength: 8,
      select: false, // never returned by default
    },

    profile_picture: {
      type: String,
      default: null,
    },

    user_role: {
      type: String,
      enum: ['user', 'admin', 'rider', 'marketing', 'customer_support'],
      default: 'user',
    },

    wallet_balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    reward_points: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Email verification
    is_email_verified: {
      type: Boolean,
      default: false,
    },
    email_verification_token: {
      type: String,
      select: false,
    },
    email_verification_expires: {
      type: Date,
      select: false,
    },

    // Phone verification
    phone_number: {
      type: String,
      default: null,
      trim: true,
    },
    is_phone_verified: {
      type: Boolean,
      default: false,
    },
    phone_verification_otp: {
      type: String,
      select: false,
    },
    otp_expires_in: {
      type: Date,
      select: false,
    },

    // Passwordless login (magic-link / email OTP)
    passwordless_login_token: {
      type: String,
      select: false,
    },
    passwordless_login_expires: {
      type: Date,
      select: false,
    },

    // Password reset
    password_reset_token: {
      type: String,
      select: false,
    },
    password_reset_expires: {
      type: Date,
      select: false,
    },

    // Social login
    auth_providers: {
      type: [String],
      enum: ['local', 'google', 'facebook'],
      default: ['local'],
    },
    google_id: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    facebook_id: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    push_tokens: [
      {
        token_type: {type:String, enum: ['FCN', 'APN']},
        token: {type:String}
      }
    ],
    is_marketing_accepted: {type:Boolean},
    // Session / security
    last_login: {
      type: Date,
      default: null,
    },
    login_attempts: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'deleted'],
      default: 'active',
    },
    is_account_locked: {
      type: Boolean,
      default: false,
    },
    account_locked_until: {
      type: Date,
      select: false,
    },
    warehouse_code: { type: String, default: null },
    is_allowed_all_warehouse: { type: Boolean, default: false },
    // Primary warehouse this user (admin/rider/staff) belongs to.
    warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouses',
      default: null,
      index: true,
    },
    // Refresh token rotation - store hashed active refresh tokens
    refresh_tokens: {
      type: [
        {
          token_hash: String,
          expires_at: Date,
          created_at: { type: Date, default: Date.now },
        },
      ],
      select: false,
      default: [],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// ---------- Hooks ----------
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ---------- Instance methods ----------
userSchema.methods.comparePassword = async function comparePassword(candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.generateEmailVerificationToken = function generateEmailVerificationToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.email_verification_token = crypto.createHash('sha256').update(rawToken).digest('hex');
  const minutes = Number(process.env.EMAIL_TOKEN_EXPIRES_MIN || 30);
  this.email_verification_expires = new Date(Date.now() + minutes * 60 * 1000);
  return rawToken; // raw token is emailed to the user, hash is stored
};

userSchema.methods.generatePasswordResetToken = function generatePasswordResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.password_reset_token = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.password_reset_expires = new Date(Date.now() + 30 * 60 * 1000);
  return rawToken;
};

userSchema.methods.generatePasswordlessToken = function generatePasswordlessToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.passwordless_login_token = crypto.createHash('sha256').update(rawToken).digest('hex');
  const minutes = Number(process.env.EMAIL_TOKEN_EXPIRES_MIN || 30);
  this.passwordless_login_expires = new Date(Date.now() + minutes * 60 * 1000);
  return rawToken;
};

userSchema.methods.generatePhoneOtp = function generatePhoneOtp() {
  const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
  this.phone_verification_otp = crypto.createHash('sha256').update(otp).digest('hex');
  const minutes = Number(process.env.OTP_EXPIRES_MIN || 10);
  this.otp_expires_in = new Date(Date.now() + minutes * 60 * 1000);
  return otp;
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.email_verification_token;
  delete obj.phone_verification_otp;
  delete obj.passwordless_login_token;
  delete obj.password_reset_token;
  delete obj.refresh_tokens;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
