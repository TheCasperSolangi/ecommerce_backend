const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Like authenticate, but never rejects the request.
 * If a valid Bearer token is present, req.user is populated.
 * If not (or if the token is invalid/expired), the request continues
 * with req.user = null — allowing public access to the same endpoint.
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    const user = await User.findById(decoded.sub);
    if (user && user.status === 'active' && !user.is_account_locked) {
      req.user = user;
    }
  } catch {
    // Invalid / expired token — treat as unauthenticated, don't block.
  }
  next();
};

module.exports = optionalAuthenticate;
