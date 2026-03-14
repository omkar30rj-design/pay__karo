const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const jwt     = require('jsonwebtoken');
const Joi     = require('joi');
const { authenticate } = require('../middleware/auth');

// POST /v1/auth/verify-token
// Client calls Firebase phone auth → gets idToken → sends here
router.post('/verify-token', async (req, res) => {
  const { idToken, fcmToken } = req.body;
  if (!idToken) return res.status(400).json({ success: false, message: 'idToken required' });

  const decoded = await admin.auth().verifyIdToken(idToken);
  const { uid, phone_number: phone } = decoded;

  const userRef = admin.firestore().collection('users').doc(uid);
  const snap    = await userRef.get();
  let isNew     = false;

  if (!snap.exists) {
    isNew = true;
    await userRef.set({
      uid, phone, name: '', upiId: '', totalBalance: 0,
      fcmToken: fcmToken || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      greenProfile: {
        monthlyScore: 0, totalCo2Kg: 0, grade: 'N/A',
        categoryBreakdown: {}, treesEquivalent: 0,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  } else if (fcmToken) {
    await userRef.update({ fcmToken });
  }

  const token = jwt.sign({ uid, phone }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, data: { token, uid, isNewUser: isNew, phone } });
});

// POST /v1/auth/setup-profile
router.post('/setup-profile', authenticate, async (req, res) => {
  const { error, value } = Joi.object({
    name:  Joi.string().min(2).max(60).required(),
    upiId: Joi.string().min(5).max(50).required(),
  }).validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.message });

  await admin.firestore().collection('users').doc(req.user.uid).update({
    name: value.name, upiId: value.upiId,
  });
  res.json({ success: true, message: 'Profile updated' });
});

// POST /v1/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  await admin.firestore().collection('users').doc(req.user.uid).update({ fcmToken: '' });
  res.json({ success: true, message: 'Logged out' });
});

module.exports = router;
