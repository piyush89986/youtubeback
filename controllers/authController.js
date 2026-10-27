const User = require('../models/User');
const YouTubeAccount = require('../models/YouTubeAccount');
const { apiSuccess, apiError } = require('../utils/apiResponse');
const env = require('../config/env');

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return apiError(res, 'Please provide name, email, and password.', 400);
    }

    if (password.length < 6) {
      return apiError(res, 'Password must be at least 6 characters long.', 400);
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return apiError(res, 'An account with this email already exists.', 409);
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
    });

    const token = user.generateAuthToken();
    res.cookie('token', token, cookieOptions);

    return apiSuccess(
      res,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          settings: user.settings,
        },
        token,
      },
      'Registration successful',
      201
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Login user & get token
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return apiError(res, 'Please provide email and password.', 400);
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user) {
      return apiError(res, 'Invalid email or password.', 401);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return apiError(res, 'Invalid email or password.', 401);
    }

    const token = user.generateAuthToken();
    res.cookie('token', token, cookieOptions);

    return apiSuccess(
      res,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          settings: user.settings,
        },
        token,
      },
      'Login successful'
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Logout user & clear cookie
// @route   POST /api/auth/logout
// @access  Public
const logout = (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
  return apiSuccess(res, null, 'Logged out successfully');
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    const user = req.user;
    const connectedChannels = await YouTubeAccount.find({
      user: user._id,
      isConnected: true,
    }).select('-encryptedAccessToken -encryptedRefreshToken');

    return apiSuccess(res, {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        settings: user.settings,
        avatar: user.avatar,
        createdAt: user.createdAt,
      },
      connectedChannels,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user profile & settings
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = async (req, res, next) => {
  try {
    const { name, settings } = req.body;
    const user = await User.findById(req.user._id);

    if (name) user.name = name.trim();
    if (settings) {
      user.settings = {
        ...user.settings,
        ...settings,
      };
    }

    await user.save();

    return apiSuccess(
      res,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          settings: user.settings,
        },
      },
      'Profile updated successfully'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfile,
};
