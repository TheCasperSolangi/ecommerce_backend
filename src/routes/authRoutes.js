const express = require('express');
const authController = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
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
} = require('../validators/authValidators');

const router = express.Router();

// -------------------- Email + Password --------------------
router.post('/register', authLimiter, registerRules, authController.register);
router.post('/login', authLimiter, loginRules, authController.login);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification-email', authLimiter, emailOnlyRules, authController.resendVerificationEmail);

// -------------------- Passwordless (magic link) --------------------
router.post('/passwordless/request', authLimiter, emailOnlyRules, authController.requestPasswordlessLogin);
router.post('/passwordless/verify', authController.verifyPasswordlessLogin);

// -------------------- Phone OTP --------------------
router.post('/phone/request-otp', otpLimiter, phoneRules, authController.requestPhoneOtp);
router.post('/phone/verify-otp', phoneOtpVerifyRules, authController.verifyPhoneOtp);

// -------------------- Password reset / change --------------------
router.post('/forgot-password', authLimiter, emailOnlyRules, authController.forgotPassword);
router.post('/reset-password', resetPasswordRules, authController.resetPassword);
router.post('/change-password', authenticate, changePasswordRules, authController.changePassword);

// -------------------- Social login --------------------
router.post('/google', authLimiter, socialLoginRules, authController.googleLogin);
router.post('/facebook', authLimiter, socialLoginRules, authController.facebookLogin);

// -------------------- Session --------------------
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);
router.get('/me', authenticate, authController.getMe);
router.patch('/me', authenticate, updateMeRules, authController.updateMe);

// -------------------- Admin --------------------
router.post(
  '/admin/create-admin',
  authenticate,
  authorize('admin'),
  createAdminRules,
  authController.createAdmin
);

module.exports = router;
