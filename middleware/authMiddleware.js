const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const { apiError } = require('../utils/apiResponse');

const authenticate = async (req, res, next) => {
  try {
    let token = null;

    // Check HTTP-only cookie first
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return apiError(res, 'Authentication required. No token provided.', 401);
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return apiError(res, 'User associated with this token no longer exists.', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return apiError(res, 'Session expired. Please log in again.', 401);
    }
    return apiError(res, 'Invalid token. Authorization denied.', 401);
  }
};

module.exports = { authenticate };
