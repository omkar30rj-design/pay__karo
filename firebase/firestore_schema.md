# FIRESTORE COLLECTION STRUCTURE — PAY KARO

## Collection: `users`
**Document:** `{uid}` (Firebase UID)

| Field | Type | Notes |
|-------|------|-------|
| uid | string | Firebase UID |
| phone | string | +91XXXXXXXXXX |
| name | string | |
| upiId | string | e.g. arjun@paykaro |
| totalBalance | number | INR, synced from bank |
| fcmToken | string | FCM push token |
| createdAt | timestamp | |
| greenProfile.monthlyScore | number | 0–100 |
| greenProfile.totalCo2Kg | number | |
| greenProfile.grade | string | A+, A, B+, B, C, D |
| greenProfile.categoryBreakdown | map | { food: 5.2, travel: 3.1, ... } |
| greenProfile.treesEquivalent | number | |
| greenProfile.lastUpdated | timestamp | |

**Subcollections:**
- `frequentContacts/{contactId}`
  - upiId: string
  - name: string
  - txnCount: number
  - lastTxnAt: timestamp

---

## Collection: `transactions`
**Document:** `{txnId}` (PKT + timestamp)

| Field | Type | Notes |
|-------|------|-------|
| userId | string | |
| toFrom | string | recipient/sender name |
| toFromUpiId | string | |
| amount | number | INR |
| type | string | debit \| credit |
| category | string | food \| travel \| shopping \| bills \| entertainment \| other |
| note | string | |
| upiRefId | string | NPCI RRN |
| createdAt | timestamp | |
| co2Kg | number | |
| isSplit | boolean | |
| splitId | string \| null | |

---

## Collection: `splits`
**Document:** `{splitId}` (UUID)

| Field | Type | Notes |
|-------|------|-------|
| title | string | |
| createdByUid | string | |
| totalAmount | number | |
| splitType | string | equal \| custom \| percentage |
| status | string | active \| settled \| cancelled |
| members | array | See below |
| createdAt | timestamp | |
| groupId | string \| null | |
| note | string \| null | |

**members array item:**
- uid: string
- name: string
- upiId: string
- owes: number
- hasPaid: boolean
- paidAt: timestamp | null

---

## Collection: `monthlySpending`
**Document:** `{uid}_{year}_{month}`

| Field | Type | Notes |
|-------|------|-------|
| userId | string | |
| year | number | |
| month | number | |
| totalSpent | number | |
| byCategory | map | { food: 8240, shopping: 6100, ... } |
| totalCo2Kg | number | |
| budget | number | default: 30000 |
| alerts | array | See below |

**alerts array item:**
- message: string
- severity: string (info | warning | danger)
- category: string
- generatedAt: timestamp

---

## Collection: `groups`
**Document:** `{groupId}`

| Field | Type | Notes |
|-------|------|-------|
| name | string | |
| type | string | friends \| roommates \| office \| travel \| other |
| emoji | string | |
| createdByUid | string | |
| memberUids | array\<string\> | |
| totalPending | number | |
| createdAt | timestamp | |

---

## Collection: `paymentRequests`
**Document:** `{requestId}`

| Field | Type | Notes |
|-------|------|-------|
| requestedByUid | string | |
| fromUpiId | string | |
| amount | number | |
| note | string | |
| status | string | pending \| paid \| rejected |
| createdAt | timestamp | |
