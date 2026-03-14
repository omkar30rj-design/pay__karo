const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /v1/insights — Monthly spending insights for the current user
router.get('/', async (req, res) => {
  const uid   = req.user.uid;
  const now   = new Date();
  const month = `${now.getFullYear()}_${now.getMonth() + 1}`;
  const snap  = await admin.firestore().collection('monthlySpending').doc(`${uid}_${month}`).get();

  if (!snap.exists) {
    return res.json({ success: true, data: null });
  }
  res.json({ success: true, data: { id: snap.id, ...snap.data() } });
});

module.exports = router;
