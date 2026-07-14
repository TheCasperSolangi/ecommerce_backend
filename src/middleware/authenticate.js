const jwt = require('jsonwebtoken');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');

const authenticate = catchAsync(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    throw new ApiError(401, 'Authentication required. Please log in.');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired access token');
  }

  const user = await User.findById(decoded.sub);
  if (!user) {
    throw new ApiError(401, 'User belonging to this token no longer exists');
  }

  if (user.status !== 'active') {
    throw new ApiError(403, `Your account is ${user.status}. Please contact support.`);
  }

  if (user.is_account_locked) {
    throw new ApiError(403, 'Your account is locked. Please contact support or reset your password.');
  }

  req.user = user;
  next();
});

module.exports = authenticate;
