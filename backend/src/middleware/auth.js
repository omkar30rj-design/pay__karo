const jwt   = require('jsonwebtoken');
const admin = require('firebase-admin');

/**
 * Middleware: authenticate — verifies JWT from Authorization header.
 * Attaches req.user = { uid, phone, name, upiId }
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
    }

    const token   = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user profile from Firestore
    const snap = await admin.firestore().collection('users').doc(decoded.uid).get();
    if (!snap.exists) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = { uid: decoded.uid, phone: decoded.phone, ...snap.data() };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError')  return res.status(401).json({ success: false, message: 'Invalid token' });
    if (err.name === 'TokenExpiredError')  return res.status(401).json({ success: false, message: 'Token expired, please re-login' });
    next(err);
  }
}

module.exports = { authenticate };
