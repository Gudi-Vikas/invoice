---
name: razorpay_route
description: >
  Razorpay Route API integration: linked account creation, stakeholder KYC, order generation
  with split transfers, partial payment configuration, webhook signature verification,
  and idempotency handling. Load this skill when working on payment flows.
triggers:
  - "razorpay"
  - "split payment"
  - "linked account"
  - "webhook"
  - "paise"
  - "order creation"
  - "KYC"
---

# Razorpay Route API Integration Skill

## Overview
Razorpay Route enables marketplace payment splitting. When a client pays an invoice,
funds are automatically routed to vendor linked accounts minus the platform commission.

---

## Vendor Onboarding Pipeline (5 Steps)

### Step 1: Create Linked Account
```javascript
POST https://api.razorpay.com/v2/accounts
{
  "email": "vendor@business.com",
  "profile": {
    "category": "it_and_software",
    "subcategory": "saas"
  },
  "type": "route",
  "legal_business_name": "Vendor Business Name",
  "customer_facing_business_name": "Vendor Display Name",
  "legal_info": {
    "pan": "AAACA1234C",
    "gst": "27AAACA1234C1Z5"
  }
}
// Returns: { id: "acc_XXXXXXXXXXXXXX", ... }
```

### Step 2: Create Stakeholder (KYC)
```javascript
POST https://api.razorpay.com/v2/accounts/{account_id}/stakeholders
{
  "name": "Authorized Signatory Name",
  "email": "signatory@business.com",
  "kyc": { "pan": "ABCDE1234F" },
  "addresses": {
    "residential": {
      "street": "123 Main St",
      "city": "Hyderabad",
      "state": "Telangana",
      "postal_code": "500032",
      "country": "IN"
    }
  }
}
```

### Step 3: Configure Route Product (Bank Details)
```javascript
PATCH https://api.razorpay.com/v2/accounts/{account_id}/products/{product_id}
{
  "settlements": {
    "account_number": "1234567890",
    "ifsc_code": "HDFC0001234",
    "beneficiary_name": "Vendor Business Name"
  },
  "tnc_accepted": true
}
```

### Step 4: OAuth Authorization Redirect
```
GET https://auth.razorpay.com/authorize?
  response_type=code&
  client_id={CLIENT_ID}&
  redirect_uri={CALLBACK_URL}&
  scope=read_write&
  state={RANDOM_STATE_TOKEN}
```

### Step 5: Token Exchange
```javascript
POST https://auth.razorpay.com/token
{
  "client_id": process.env.RAZORPAY_KEY_ID,
  "client_secret": process.env.RAZORPAY_KEY_SECRET,
  "redirect_uri": process.env.RAZORPAY_CALLBACK_URL,
  "grant_type": "authorization_code",
  "code": "{code_from_callback}"
}
```

---

## Order Creation with Split Transfers

### Critical Rules
1. **Amount is always in PAISE** (1 INR = 100 paise). Multiply by 100, use `Math.round()`.
2. Transfer amounts must NEVER exceed the parent order amount.
3. Unallocated balance auto-routes to the platform's nodal account.

### Full Payload Structure
```javascript
const orderPayload = {
  amount: Math.round(invoiceTotalRupees * 100), // e.g., 25000 → 2500000
  currency: 'INR',
  receipt: documentNumber, // e.g., "AKEYI-0125"
  payment_capture: 1,
  partial_payment: allowPartialPayment, // boolean from invoice settings
  // If partial_payment: true, optionally set:
  // first_payment_min_amount: Math.round(minimumAdvanceRupees * 100)
  transfers: vendors.map(v => ({
    account: v.razorpayAccountId,     // "acc_XXXXXXXXXXXXXX"
    amount: Math.round(v.vendorShareRupees * 100),
    currency: 'INR',
    on_hold: 0,
    notes: {
      vendor_id: v.vendorId,
      description: `Split for: ${v.description}`
    }
  }))
};
```

### Transfer Amount Validation
```javascript
const totalTransferAmount = transfers.reduce((sum, t) => sum + t.amount, 0);
if (totalTransferAmount > orderPayload.amount) {
  throw new Error('Transfer amounts exceed order total. Razorpay will reject this.');
}
```

---

## Webhook Signature Verification

Razorpay signs every webhook with HMAC-SHA256 using the webhook secret.
The signature is in the `x-razorpay-signature` header.

```javascript
import crypto from 'crypto';

export const verifyWebhookSignature = (rawBody, signature) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)  // rawBody MUST be the raw string/buffer, NOT parsed JSON
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(signature, 'hex')
  );
};
```

**Critical**: The `rawBody` must be captured BEFORE `express.json()` parses it.
In server.js:
```javascript
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf ? buf.toString() : ''; }
}));
```

---

## Webhook Event Types

| Event | Meaning | Action |
|---|---|---|
| `order.paid` | Full order amount received | Update invoice to 'paid', post payment ledger |
| `payment.captured` | Individual payment captured | Record payment ID |
| `transfer.processed` | Vendor split routed | Update transfer record |
| `settlement.processed` | Funds cleared to bank | Close vendor payable liability |
| `subscription.charged` | SaaS subscription renewed | Extend `current_period_end` |
| `subscription.failed` | Payment failed | Set tenant status to 'suspended' |

---

## Idempotency Pattern

Every webhook handler MUST check idempotency BEFORE processing:

```javascript
// 1. Check if already processed
const existing = await pool.query(
  'SELECT 1 FROM processed_events WHERE id = $1',
  [eventId]
);
if (existing.rows.length > 0) {
  return res.status(200).json({ message: 'Already processed (idempotent).' });
}

// 2. Mark as processed FIRST (before business logic)
await pool.query(
  'INSERT INTO processed_events (id) VALUES ($1) ON CONFLICT DO NOTHING',
  [eventId]
);

// 3. Execute business logic
// ... (if this fails, next retry will be blocked — acceptable for financial systems)
```

---

## Mock Mode (Development)

When `RAZORPAY_KEY_ID` is absent or starts with `rzp_test_mockkey`, the service
returns deterministic mock responses with randomly generated IDs.

Mock responses follow the same structure as live Razorpay responses, ensuring
the application logic works identically in dev and production.

---

## Environment Variables Required

```bash
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
RAZORPAY_CALLBACK_URL=https://yourdomain.com/api/v1/vendors/oauth/callback
```
