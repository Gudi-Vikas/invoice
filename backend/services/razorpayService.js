import crypto from 'crypto';
import Razorpay from 'razorpay';

// Read credentials from environment
const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_123';

const isMockMode = !keyId || keyId.startsWith('rzp_test_mockkey') || !keySecret;

let razorpayClient = null;
if (!isMockMode) {
  razorpayClient = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
}

/**
 * Razorpay Integration Service with Mock Fallback for Local Development.
 */
export const razorpayService = {
  isMockMode,

  /**
   * 1. Creates a Linked Account for a vendor via Razorpay Onboarding Route APIs.
   * See Razorpay Route Account creation flow.
   */
  createLinkedAccount: async (vendorName, email) => {
    console.log(`[Razorpay Service] Creating account for vendor: ${vendorName} (${email})`);
    if (isMockMode) {
      const mockAccountId = `acc_${crypto.randomBytes(8).toString('hex')}`;
      return {
        id: mockAccountId,
        status: 'created',
        email,
        type: 'route_linked'
      };
    }

    try {
      const response = await razorpayClient.accounts.create({
        email: email,
        phone: '9999999999',
        type: 'route',
        reference_id: `vendor_${Date.now()}`,
        legal_business_name: vendorName,
        customer_facing_business_name: vendorName
      });
      return response;
    } catch (err) {
      console.error('Razorpay account creation error:', err);
      throw err;
    }
  },

  /**
   * 2. Submits Stakeholder KYC details.
   */
  addStakeholder: async (accountId, stakeholderData) => {
    console.log(`[Razorpay Service] Adding stakeholder to account ${accountId}`);
    if (isMockMode) {
      return {
        id: `stk_${crypto.randomBytes(8).toString('hex')}`,
        account_id: accountId,
        status: 'active'
      };
    }

    try {
      // Direct API call mapping or SDK mapping for stakeholder
      const response = await razorpayClient.accounts.createStakeholder(accountId, {
        name: stakeholderData.name,
        email: stakeholderData.email,
        kyc: {
          pan: stakeholderData.pan,
          passport: stakeholderData.passport
        },
        addresses: {
          residential: stakeholderData.address
        }
      });
      return response;
    } catch (err) {
      console.error('Razorpay stakeholder submission error:', err);
      throw err;
    }
  },

  /**
   * 3. Uploads verification documents (GST certificates, corporate PANs, incorporation deeds).
   */
  uploadDocument: async (accountId, filePath, documentType) => {
    console.log(`[Razorpay Service] Uploading ${documentType} for account ${accountId} from path ${filePath}`);
    if (isMockMode) {
      return {
        id: `doc_${crypto.randomBytes(8).toString('hex')}`,
        account_id: accountId,
        document_type: documentType,
        status: 'uploaded'
      };
    }

    try {
      // Razorpay file upload relies on form-data transmission
      const response = await razorpayClient.accounts.uploadDocument(accountId, {
        document_type: documentType,
        file: filePath
      });
      return response;
    } catch (err) {
      console.error('Razorpay document upload error:', err);
      throw err;
    }
  },

  /**
   * 4. Requests Route product activation and adds bank account info.
   */
  configureRouteProduct: async (accountId, bankDetails) => {
    console.log(`[Razorpay Service] Configuring Route product for account ${accountId}`);
    if (isMockMode) {
      return {
        account_id: accountId,
        product: 'route',
        status: 'under_review'
      };
    }

    try {
      const response = await razorpayClient.accounts.configureProduct(accountId, 'route', {
        bank_account: {
          ifsc_code: bankDetails.ifsc,
          account_number: bankDetails.accountNumber,
          beneficiary_name: bankDetails.beneficiaryName
        }
      });
      return response;
    } catch (err) {
      console.error('Razorpay product configuration error:', err);
      throw err;
    }
  },

  /**
   * 5. Creates a Razorpay Order with custom Split Payment Transfers.
   * Amount is in paise (1 INR = 100 paise) for Razorpay API standard.
   */
  createOrderWithSplits: async (amountInRupees, transfersList) => {
    const amountInPaise = Math.round(parseFloat(amountInRupees) * 100);
    console.log(`[Razorpay Service] Creating order for ${amountInRupees} INR (${amountInPaise} paise) with transfers:`, transfersList);

    // Map transfers to Razorpay schema format
    const transfersPayload = transfersList.map(t => ({
      account: t.razorpayAccountId,
      amount: Math.round(parseFloat(t.amount) * 100),
      currency: 'INR',
      on_hold: t.on_hold,
      notes: {
        vendor_id: t.vendorId,
        invoice_item_desc: t.description || 'Split share',
        ...t.notes
      }
    }));

    if (isMockMode) {
      const mockOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;
      return {
        id: mockOrderId,
        amount: amountInPaise,
        currency: 'INR',
        status: 'created',
        transfers: transfersPayload
      };
    }

    try {
      const response = await razorpayClient.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        transfers: transfersPayload
      });
      return response;
    } catch (err) {
      console.error('Razorpay order splits creation error:', err);
      throw err;
    }
  },

  /**
   * Creates a plain Razorpay order for Ultrakey platform subscription billing.
   */
  createOrder: async ({ amountInRupees, receipt, notes = {} }) => {
    const amountInPaise = Math.round(parseFloat(amountInRupees) * 100);

    if (isMockMode) {
      return {
        id: `order_${crypto.randomBytes(8).toString('hex')}`,
        amount: amountInPaise,
        currency: 'INR',
        receipt,
        status: 'created',
        notes
      };
    }

    try {
      return await razorpayClient.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt,
        notes
      });
    } catch (err) {
      console.error('Razorpay order creation error:', err);
      throw err;
    }
  },

  verifyPaymentSignature: ({ orderId, paymentId, signature }) => {
    if (isMockMode) return true;
    if (!orderId || !paymentId || !signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    return expectedSignature === signature;
  },

  /**
   * 6. Creates a subscription plan and instance link in Razorpay.
   */
  createSubscription: async (planProductId, customerEmail) => {
    console.log(`[Razorpay Service] Subscribing customer ${customerEmail} to product ${planProductId}`);
    if (isMockMode) {
      return {
        id: `sub_${crypto.randomBytes(8).toString('hex')}`,
        status: 'active',
        plan_id: planProductId,
        current_period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000) // 30 days out
      };
    }

    try {
      const response = await razorpayClient.subscriptions.create({
        plan_id: planProductId,
        total_count: 12, // Standard annual limit cycle
        quantity: 1,
        customer_notify: 1
      });
      return response;
    } catch (err) {
      console.error('Razorpay subscription creation error:', err);
      throw err;
    }
  },

  /**
   * 7. Validates Razorpay Webhook Signatures cryptographically.
   */
  verifyWebhookSignature: (rawBody, signature) => {
    if (isMockMode) {
      // In mock local mode, we allow authentication skip or basic checking
      return true;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      return expectedSignature === signature;
    } catch (err) {
      console.error('Webhook signature verification failure:', err);
      return false;
    }
  },

  /**
   * 8. Exchanges Razorpay OAuth authorization code for access tokens.
   */
  exchangeOAuthCode: async (code, redirectUri) => {
    console.log(`[Razorpay Service] Exchanging OAuth authorization code: ${code}`);
    if (isMockMode) {
      const mockAccountId = `acc_oauth_${crypto.randomBytes(8).toString('hex')}`;
      return {
        access_token: `mock_access_token_${crypto.randomBytes(8).toString('hex')}`,
        razorpay_account_id: mockAccountId,
        status: 'active'
      };
    }

    try {
      const response = await fetch('https://auth.razorpay.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: keyId,
          client_secret: keySecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code: code
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Razorpay OAuth token exchange failed: ${errText}`);
      }

      const data = await response.json();
      return {
        access_token: data.access_token,
        razorpay_account_id: data.razorpay_user_id || data.account_id,
        status: 'active'
      };
    } catch (err) {
      console.error('Razorpay OAuth exchange error:', err);
      throw err;
    }
  },

  /**
   * 9. Creates a Razorpay Plan for subscription billing.
   * Plans are required by the Razorpay Subscriptions API before creating subscriptions.
   *
   * @param {Object} params
   * @param {string} params.name - Plan display name
   * @param {string} params.description - Plan description
   * @param {number} params.amountInRupees - Monthly price in rupees
   * @param {string} [params.interval='monthly'] - 'monthly' or 'yearly'
   * @param {number} [params.period=1] - Interval multiplier (e.g., 1 month, 12 months)
   * @returns {Object} Razorpay Plan object with { id, ... }
   */
  createRazorpayPlan: async ({ name, description, amountInRupees, interval = 'monthly', period = 1 }) => {
    const amountInPaise = Math.round(parseFloat(amountInRupees) * 100);
    console.log(`[Razorpay Service] Creating plan: ${name} — ₹${amountInRupees} (${amountInPaise} paise) per ${period} ${interval}`);

    if (isMockMode) {
      const mockPlanId = `plan_${crypto.randomBytes(8).toString('hex')}`;
      return {
        id: mockPlanId,
        entity: 'plan',
        interval: period,
        period: interval,
        item: { id: `item_${crypto.randomBytes(8).toString('hex')}`, name, amount: amountInPaise, currency: 'INR' },
        notes: [],
        created_at: Math.floor(Date.now() / 1000)
      };
    }

    try {
      const response = await razorpayClient.plans.create({
        period: interval,
        interval: period,
        item: {
          name,
          amount: amountInPaise,
          currency: 'INR',
          description: description || name
        },
        notes: {
          platform: 'ultrakey_invoice_saas'
        }
      });
      console.log(`[Razorpay Service] Plan created: ${response.id}`);
      return response;
    } catch (err) {
      console.error('Razorpay plan creation error:', err);
      throw err;
    }
  },

  /**
   * 10. Fetches a Razorpay Plan by its ID.
   */
  fetchRazorpayPlan: async (planId) => {
    if (isMockMode) {
      return { id: planId, entity: 'plan', period: 'monthly', interval: 1 };
    }

    try {
      return await razorpayClient.plans.fetch(planId);
    } catch (err) {
      console.error('Razorpay plan fetch error:', err);
      throw err;
    }
  },

  /**
   * 11. Creates a direct transfer from the merchant's account balance to a linked account.
   */
  createDirectTransfer: async (accountId, amountInRupees) => {
    const amountInPaise = Math.round(parseFloat(amountInRupees) * 100);
    console.log(`[Razorpay Service] Creating direct transfer of ${amountInRupees} INR (${amountInPaise} paise) to account: ${accountId}`);

    if (isMockMode) {
      return {
        id: `trsf_${crypto.randomBytes(8).toString('hex')}`,
        account: accountId,
        amount: amountInPaise,
        currency: 'INR',
        status: 'processed'
      };
    }

    try {
      const response = await razorpayClient.transfers.create({
        account: accountId,
        amount: amountInPaise,
        currency: 'INR'
      });
      return response;
    } catch (err) {
      console.error('Razorpay direct transfer error:', err);
      throw err;
    }
  }
};

export default razorpayService;
