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
      notes: {
        vendor_id: t.vendorId,
        invoice_item_desc: t.description || 'Split share'
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
  }
};

export default razorpayService;
