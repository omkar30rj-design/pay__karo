'use strict';

// ── CO₂ emission factors — kg CO₂ per ₹1000 spent ───────────────
// Sources: DEFRA 2023, India GHG Platform, WRAP, lifecycle assessments
const EMISSION_FACTORS = {
  food:          { base: 2.1, subcategories: { swiggy: 2.8, zomato: 2.8, mcdonald: 3.4, kfc: 3.2, veg: 1.4 } },
  travel:        { base: 4.8, subcategories: { uber: 5.2, ola: 4.8, rapido: 1.1, metro: 0.3, irctc: 0.4, indigo: 12.0, petrol: 11.0 } },
  shopping:      { base: 3.2, subcategories: { myntra: 4.0, zara: 4.5, amazon: 2.0, flipkart: 2.0, electronics: 4.5 } },
  bills:         { base: 1.6, subcategories: { electricity: 8.2, gas: 2.0, internet: 0.8, mobile: 0.5 } },
  entertainment: { base: 0.3, subcategories: { netflix: 0.08, spotify: 0.05, bookmyshow: 2.5, gaming: 1.2 } },
  other:         { base: 1.0 },
};

// NPCI MCC → spending category
const MCC_TO_CATEGORY = {
  '5812': 'food',  '5814': 'food',  '5411': 'food',  '5441': 'food',
  '4111': 'travel','4121': 'travel','4131': 'travel', '5541': 'travel','4511': 'travel',
  '5311': 'shopping','5691': 'shopping','5732': 'shopping','5945': 'shopping',
  '4900': 'bills', '4941': 'bills', '4911': 'bills',  '4814': 'bills',
  '7832': 'entertainment','7929': 'entertainment','7922': 'entertainment','5735': 'entertainment',
};

/**
 * Estimate CO₂ for a transaction
 * @param {string} category
 * @param {number} amount — INR
 * @param {string} [vpa]  — merchant UPI ID for subcategory detection
 * @returns {number} co2Kg
 */
function estimateCo2({ category, amount, vpa = '' }) {
  const catData = EMISSION_FACTORS[category] || EMISSION_FACTORS.other;
  let factor    = catData.base;
  if (catData.subcategories && vpa) {
    const v = vpa.toLowerCase();
    for (const [key, subFactor] of Object.entries(catData.subcategories)) {
      if (v.includes(key)) { factor = subFactor; break; }
    }
  }
  return Math.round((amount / 1000) * factor * 100) / 100;
}

function categorizeMcc(mcc) {
  return MCC_TO_CATEGORY[mcc] || 'other';
}

function calculateGreenGrade(totalCo2Kg) {
  if (totalCo2Kg <= 10) return { grade: 'A+', score: 95 };
  if (totalCo2Kg <= 15) return { grade: 'A',  score: 87 };
  if (totalCo2Kg <= 20) return { grade: 'B+', score: 72 };
  if (totalCo2Kg <= 25) return { grade: 'B',  score: 58 };
  if (totalCo2Kg <= 35) return { grade: 'C',  score: 42 };
  return { grade: 'D', score: 25 };
}

function generateEcoTips(categoryBreakdown) {
  const tips = [];
  if ((categoryBreakdown.travel   || 0) > 2000) tips.push({ category: 'travel',   tip: 'Switch 3 cab rides/week to metro — saves ~4 kg CO₂/month 🚇',            co2Saved: 4.0 });
  if ((categoryBreakdown.food     || 0) > 5000) tips.push({ category: 'food',     tip: 'Cook at home twice a week — reduces food carbon footprint by 30% 🥘',      co2Saved: 2.5 });
  if ((categoryBreakdown.shopping || 0) > 3000) tips.push({ category: 'shopping', tip: 'Choose thrifted or local brands over fast fashion 🌿',                      co2Saved: 3.0 });
  return tips;
}

module.exports = { estimateCo2, categorizeMcc, calculateGreenGrade, generateEcoTips };
