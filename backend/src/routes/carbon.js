const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const { authenticate } = require('../middleware/auth');
const { calculateGreenGrade, generateEcoTips } = require('../services/carbonService');

router.use(authenticate);

// GET /v1/carbon — Current user's green profile & eco tips
router.get('/', async (req, res) => {
  const uid  = req.user.uid;
  const snap = await admin.firestore().collection('users').doc(uid).get();
  if (!snap.exists) return res.status(404).json({ success: false, message: 'User not found' });

  const greenProfile = snap.data()?.greenProfile || {};
  const tips         = generateEcoTips(greenProfile.categoryBreakdown || {});
  const gradeInfo    = calculateGreenGrade(greenProfile.totalCo2Kg || 0);

  res.json({
    success: true,
    data: {
      ...greenProfile,
      grade:     gradeInfo.grade,
      score:     gradeInfo.score,
      ecoTips:   tips,
    },
  });
});

module.exports = router;
