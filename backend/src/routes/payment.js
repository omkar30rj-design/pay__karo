const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const Joi     = require('joi');
const admin   = require('firebase-admin');
const axios   = require('axios');
const { authenticate } = require('../middleware/auth');
const { estimateCo2, categorizeMcc } = require('../services/carbonService');

router.use(authenticate);

// ── GET /v1/payment/validate-upi?upiId=xxx ────────────────────────
router.get('/validate-upi', async (req, res) => {
  const { upiId } = req.query;
  if (!upiId) return res.status(400).json({ success: false, message: 'upiId required' });

  const result = await validateUpiWithNpci(upiId);
  res.json({ success: true, data: result });
});

// ── POST /v1/payment/balance ──────────────────────────────────────
router.post('/balance', async (req, res) => {
  const { upiId } = req.body;
  const balance = await fetchNpciBalance(upiId || req.user.upiId);
  res.json({ success: true, data: { balance, currency: 'INR', timestamp: new Date().toISOString() } });
});

// ── POST /v1/payment/initiate ─────────────────────────────────────
const paySchema = Joi.object({
  toUpiId:     Joi.string().min(3).required(),
  amount:      Joi.number().positive().max(100000).required(),  // ₹1L daily limit
  note:        Joi.string().max(50).optional().default(''),
  splitId:     Joi.string().uuid().optional(),
  merchantMcc: Joi.string().length(4).optional(),
});

router.post('/initiate', async (req, res) => {
  const { error, value } = paySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  const { toUpiId, amount, note, splitId, merchantMcc } = value;
  const { uid, upiId: fromUpiId, name: fromName } = req.user;
  const txnRefId = `PKT${Date.now()}${uuidv4().slice(0, 6).toUpperCase()}`;

  // 1. Validate recipient
  const recipient = await validateUpiWithNpci(toUpiId);
  if (!recipient.valid) return res.status(400).json({ success: false, message: `UPI ID '${toUpiId}' not found` });

  // 2. NPCI sandbox transfer
  const upiResult = await initiateNpciTransfer({ fromUpiId, toUpiId, amount, note, txnRefId });
  if (!upiResult.success) return res.status(402).json({ success: false, message: upiResult.message || 'Payment failed at bank' });

  // 3. Categorise + estimate CO₂
  const category = merchantMcc ? categorizeMcc(merchantMcc) : inferCategoryFromVpa(toUpiId);
  const co2Kg    = estimateCo2({ category, amount, vpa: toUpiId });

  // 4. Save to Firestore
  const txnRef = await admin.firestore().collection('transactions').add({
    userId: uid, toFrom: recipient.name || toUpiId, toFromUpiId: toUpiId,
    amount, type: 'debit', category, note, upiRefId: txnRefId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    co2Kg, isSplit: !!splitId, splitId: splitId || null,
  });

  // 5. Deduct balance from sender's user doc
  await admin.firestore().collection('users').doc(uid).update({
    totalBalance: admin.firestore.FieldValue.increment(-amount),
  });

  // 6. Update monthly spending aggregate
  const month      = `${new Date().getFullYear()}_${new Date().getMonth() + 1}`;
  const monthlyRef = admin.firestore().collection('monthlySpending').doc(`${uid}_${month}`);
  await admin.firestore().runTransaction(async (t) => {
    const snap = await t.get(monthlyRef);
    if (snap.exists) {
      t.update(monthlyRef, {
        totalSpent: admin.firestore.FieldValue.increment(amount),
        [`byCategory.${category}`]: admin.firestore.FieldValue.increment(amount),
        totalCo2Kg: admin.firestore.FieldValue.increment(co2Kg),
      });
    } else {
      t.set(monthlyRef, {
        userId: uid, year: new Date().getFullYear(), month: new Date().getMonth() + 1,
        totalSpent: amount, byCategory: { [category]: amount },
        totalCo2Kg: co2Kg, budget: 30000, alerts: [],
      });
    }
  });

  // 7. Update green profile
  await updateGreenProfile(uid, co2Kg, category);

  // 8. Mark split member paid if applicable
  if (splitId) {
    const splitRef  = admin.firestore().collection('splits').doc(splitId);
    const splitSnap = await splitRef.get();
    if (splitSnap.exists) {
      const members = splitSnap.data().members.map(m =>
        m.uid === uid ? { ...m, hasPaid: true, paidAt: new Date() } : m
      );
      const allPaid = members.every(m => m.hasPaid);
      await splitRef.update({ members, status: allPaid ? 'settled' : 'active' });
    }
  }

  // 9. Push notification to recipient
  const recipientSnap = await admin.firestore().collection('users').where('upiId', '==', toUpiId).limit(1).get();
  if (!recipientSnap.empty) {
    const recipientToken = recipientSnap.docs[0].data().fcmToken;
    if (recipientToken) {
      await admin.messaging().send({
        token: recipientToken,
        notification: { title: '💰 Money Received!', body: `₹${amount} received from ${fromName}` },
        data: { type: 'payment_received', txnId: txnRef.id, amount: String(amount) },
      }).catch(() => {}); // Non-blocking
    }
  }

  res.json({
    success: true,
    data: {
      txnId: txnRef.id, txnRefId, amount, toUpiId,
      toName: recipient.name || toUpiId,
      status: 'success', co2Kg, category,
      timestamp: new Date().toISOString(),
    },
  });
});

// ── GET /v1/payment/status/:refId ─────────────────────────────────
router.get('/status/:refId', async (req, res) => {
  const { refId } = req.params;
  const snap = await admin.firestore().collection('transactions')
    .where('upiRefId', '==', refId).where('userId', '==', req.user.uid).limit(1).get();
  if (snap.empty) return res.status(404).json({ success: false, message: 'Transaction not found' });
  res.json({ success: true, data: { id: snap.docs[0].id, ...snap.docs[0].data() } });
});

// ── GET /v1/payment/history ───────────────────────────────────────
router.get('/history', async (req, res) => {
  const { limit = 20, category } = req.query;
  let query = admin.firestore().collection('transactions')
    .where('userId', '==', req.user.uid)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(parseInt(limit), 100));
  if (category) query = query.where('category', '==', category);
  const snap         = await query.get();
  const transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json({ success: true, data: { transactions, count: transactions.length } });
});

// ── POST /v1/payment/request ──────────────────────────────────────
router.post('/request', async (req, res) => {
  const { fromUpiId, amount, note } = req.body;
  const requestId = uuidv4();
  await admin.firestore().collection('paymentRequests').doc(requestId).set({
    requestId, requestedByUid: req.user.uid, fromUpiId, amount, note,
    status: 'pending', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ success: true, data: { requestId } });
});

// ── Helpers ───────────────────────────────────────────────────────

async function validateUpiWithNpci(upiId) {
  try {
    const res = await axios.post(
      `${process.env.NPCI_SANDBOX_URL}/vpa/validate`,
      { vpa: upiId },
      { headers: { 'X-API-Key': process.env.NPCI_API_KEY }, timeout: 5000 },
    );
    return { valid: res.data?.isValid === true, name: res.data?.name || '', bank: res.data?.bank || '' };
  } catch {
    if (process.env.NODE_ENV !== 'production') return { valid: true, name: 'Test User', bank: 'Test Bank' };
    return { valid: false };
  }
}

async function initiateNpciTransfer({ fromUpiId, toUpiId, amount, note, txnRefId }) {
  try {
    const res = await axios.post(
      `${process.env.NPCI_SANDBOX_URL}/payments/pay`,
      { fromVpa: fromUpiId, toVpa: toUpiId, amount, txnId: txnRefId, note, currency: 'INR' },
      { headers: { 'X-API-Key': process.env.NPCI_API_KEY }, timeout: 10000 },
    );
    return { success: res.data.status === 'SUCCESS', upiRefId: res.data.rrn };
  } catch {
    if (process.env.NODE_ENV !== 'production') return { success: true, upiRefId: `RRN${Date.now()}` };
    return { success: false, message: 'Payment gateway error' };
  }
}

async function fetchNpciBalance(upiId) {
  if (process.env.NODE_ENV !== 'production') {
    return {
      total: 124850,
      accounts: [
        { bank: 'HDFC', last4: '4821', balance: 82400 },
        { bank: 'SBI',  last4: '9031', balance: 42450 },
      ],
    };
  }
  const res = await axios.post(
    `${process.env.NPCI_SANDBOX_URL}/balance`,
    { vpa: upiId },
    { headers: { 'X-API-Key': process.env.NPCI_API_KEY } },
  );
  return res.data;
}

function inferCategoryFromVpa(vpa) {
  const v = vpa.toLowerCase();
  if (/swiggy|zomato|food|restaurant|cafe/.test(v))       return 'food';
  if (/ola|uber|metro|irctc|rapido|transport/.test(v))    return 'travel';
  if (/amazon|flipkart|myntra|meesho|zara/.test(v))       return 'shopping';
  if (/netflix|spotify|bookmyshow|hotstar/.test(v))       return 'entertainment';
  if (/electricity|airtel|jio|bsnl|gas|water/.test(v))    return 'bills';
  return 'other';
}

async function updateGreenProfile(uid, co2Kg, category) {
  const userRef = admin.firestore().collection('users').doc(uid);
  await admin.firestore().runTransaction(async (t) => {
    const snap   = await t.get(userRef);
    const gp     = snap.data()?.greenProfile || { totalCo2Kg: 0, categoryBreakdown: {} };
    const newCo2 = (gp.totalCo2Kg || 0) + co2Kg;
    const nationalAvg = 28.0;
    const score  = Math.max(0, Math.min(100, ((nationalAvg * 3 - newCo2) / (nationalAvg * 3)) * 100));
    const grade  = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+' : score >= 60 ? 'B' : score >= 50 ? 'C' : 'D';
    t.update(userRef, {
      'greenProfile.totalCo2Kg':    newCo2,
      'greenProfile.monthlyScore':  score,
      'greenProfile.grade':         grade,
      [`greenProfile.categoryBreakdown.${category}`]: admin.firestore.FieldValue.increment(co2Kg),
      'greenProfile.lastUpdated':   admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

module.exports = router;
