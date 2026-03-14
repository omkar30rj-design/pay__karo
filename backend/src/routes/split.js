const express = require('express');
const router  = express.Router();
const Joi     = require('joi');
const admin   = require('firebase-admin');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// POST /v1/split — Create a new split bill
router.post('/', async (req, res) => {
  const { error, value } = Joi.object({
    title:       Joi.string().min(2).max(100).required(),
    totalAmount: Joi.number().positive().required(),
    splitType:   Joi.string().valid('equal', 'custom', 'percentage').default('equal'),
    members:     Joi.array().items(Joi.object({
      uid:        Joi.string().required(),
      upiId:      Joi.string().required(),
      name:       Joi.string().required(),
      owes:       Joi.number().optional(),
      percentage: Joi.number().optional(),
    })).min(1).required(),
    groupId: Joi.string().optional(),
    note:    Joi.string().max(100).optional(),
  }).validate(req.body);

  if (error) return res.status(400).json({ success: false, message: error.message });

  const { title, totalAmount, splitType, members, groupId, note } = value;

  // Compute per-member shares
  const computedMembers = members.map((m) => {
    let owes;
    if (splitType === 'equal')           owes = totalAmount / members.length;
    else if (splitType === 'percentage') owes = (m.percentage / 100) * totalAmount;
    else                                 owes = m.owes || 0;
    return { ...m, owes: Math.round(owes * 100) / 100, hasPaid: m.uid === req.user.uid, paidAt: null };
  });

  const splitRef = await admin.firestore().collection('splits').add({
    title, createdByUid: req.user.uid, totalAmount, splitType,
    status: 'active', members: computedMembers,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    groupId: groupId || null, note: note || null,
  });

  // Notify all members (non-blocking)
  computedMembers.filter(m => m.uid !== req.user.uid).forEach(async (m) => {
    const memberSnap = await admin.firestore().collection('users').doc(m.uid).get();
    const token = memberSnap.data()?.fcmToken;
    if (token) {
      admin.messaging().send({
        token,
        notification: { title: '💸 Payment Request', body: `${req.user.name} added you to "${title}". Your share: ₹${m.owes}` },
        data: { type: 'split_request', splitId: splitRef.id, amount: String(m.owes) },
      }).catch(() => {});
    }
  });

  res.status(201).json({ success: true, data: { splitId: splitRef.id, members: computedMembers } });
});

// GET /v1/split — List user's splits
router.get('/', async (req, res) => {
  const { status = 'active' } = req.query;
  const uid = req.user.uid;
  const snap = await admin.firestore().collection('splits')
    .where('members', 'array-contains', { uid })
    .orderBy('createdAt', 'desc').limit(50).get();
  let splits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (status !== 'all') splits = splits.filter(s => s.status === status);
  res.json({ success: true, data: splits });
});

// POST /v1/split/:splitId/settle
router.post('/:splitId/settle', async (req, res) => {
  const { splitId } = req.params;
  const uid       = req.user.uid;
  const splitRef  = admin.firestore().collection('splits').doc(splitId);
  const snap      = await splitRef.get();
  if (!snap.exists) return res.status(404).json({ success: false, message: 'Split not found' });

  const members = snap.data().members.map(m =>
    m.uid === uid ? { ...m, hasPaid: true, paidAt: new Date() } : m
  );
  const allPaid = members.every(m => m.hasPaid);
  await splitRef.update({ members, status: allPaid ? 'settled' : 'active' });
  res.json({ success: true, data: { splitId, settled: allPaid } });
});

// POST /v1/split/:splitId/remind
router.post('/:splitId/remind', async (req, res) => {
  const { splitId } = req.params;
  const snap = await admin.firestore().collection('splits').doc(splitId).get();
  if (!snap.exists) return res.status(404).json({ success: false });
  const { members, title } = snap.data();
  const pending = members.filter(m => !m.hasPaid);

  for (const m of pending) {
    const memberSnap = await admin.firestore().collection('users').doc(m.uid).get();
    const token = memberSnap.data()?.fcmToken;
    if (token) {
      admin.messaging().send({
        token,
        notification: { title: '⏰ Payment Reminder', body: `Please pay ₹${m.owes} for "${title}"` },
        data: { type: 'split_reminder', splitId },
      }).catch(() => {});
    }
  }
  res.json({ success: true, data: { reminded: pending.length } });
});

module.exports = router;
