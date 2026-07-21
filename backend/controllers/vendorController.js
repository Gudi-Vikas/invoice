import { runInTransaction } from '../config/db.js';
import razorpayService from '../services/razorpayService.js';
import { postLedgerTransaction } from '../services/ledgerService.js';

/**
 * Controller managing Marketplace Vendor Onboarding and KYC workflows.
 */
export const vendorController = {
  /**
   * 1. Onboards a new vendor and creates a Razorpay Route Linked Account.
   */
  createVendor: async (req, res, next) => {
    const { businessName, email, platformFeePercentage } = req.body;

    if (!businessName || !email) {
      return res.status(400).json({ error: 'Vendor business name and email address are required.' });
    }

    try {
      const vendorResult = await runInTransaction(req.tenantId, async (client) => {
        const existing = await client.query(
          `SELECT id FROM vendors WHERE tenant_id = $1 AND email = $2`,
          [req.tenantId, email]
        );
        if (existing.rows.length > 0) {
          throw Object.assign(new Error('A vendor with this email already exists.'), { status: 409 });
        }

        // A. Insert vendor locally
        const insertRes = await client.query(
          `INSERT INTO vendors (tenant_id, business_name, email, platform_fee_percentage, kyc_status)
           VALUES ($1, $2, $3, $4, 'uninitiated')
           RETURNING *`,
          [req.tenantId, businessName, email, platformFeePercentage || 5.00]
        );
        const vendor = insertRes.rows[0];

        // B. Provision a Route Linked Account in Razorpay
        const rzpAccount = await razorpayService.createLinkedAccount(businessName, email);

        // C. Record Linked Account mapping
        await client.query(
          `INSERT INTO linked_accounts (vendor_id, tenant_id, razorpay_account_id, status)
           VALUES ($1, $2, $3, $4)`,
          [vendor.id, req.tenantId, rzpAccount.id, 'created']
        );

        // D. Update vendor status
        const updateRes = await client.query(
          `UPDATE vendors SET kyc_status = 'uninitiated' WHERE id = $1 RETURNING *`,
          [vendor.id]
        );

        return { vendor: updateRes.rows[0], razorpayAccountId: rzpAccount.id };
      });

      return res.status(201).json({
        message: 'Vendor registered. Onboarding workflow initialized.',
        data: vendorResult
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 2. Submits stakeholder details and destination bank accounts for KYC validation.
   */
  submitKyc: async (req, res, next) => {
    const { id } = req.params;
    const { stakeholder, bankDetails } = req.body;

    if (!stakeholder || !bankDetails) {
      return res.status(400).json({ error: 'Stakeholder info and bank details are required for KYC submission.' });
    }

    try {
      const updatedVendor = await runInTransaction(req.tenantId, async (client) => {
        // Fetch matching linked account
        const accountRes = await client.query(
          `SELECT la.razorpay_account_id, v.kyc_status
           FROM linked_accounts la
           JOIN vendors v ON la.vendor_id = v.id
           WHERE v.tenant_id = $1 AND v.id = $2`,
          [req.tenantId, id]
        );

        if (accountRes.rows.length === 0) {
          throw new Error('Vendor or linked account mapping not found.');
        }

        const rzpAccountId = accountRes.rows[0].razorpay_account_id;

        // Step 1: Submit signatory KYC details to Razorpay
        await razorpayService.addStakeholder(rzpAccountId, stakeholder);

        // Step 2: Bind bank routing specifications
        await razorpayService.configureRouteProduct(rzpAccountId, bankDetails);

        // Step 3: Update local state to show review process is pending
        const updateRes = await client.query(
          `UPDATE vendors SET kyc_status = 'under_review' WHERE id = $1 RETURNING *`,
          [id]
        );

        return updateRes.rows[0];
      });

      return res.json({
        message: 'KYC applications successfully submitted to verification partner.',
        data: updatedVendor
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 3. Lists all onboarding vendors under this tenant context.
   */
  getVendors: async (req, res, next) => {
    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        const vendorsQuery = await client.query(
          `SELECT v.*, la.razorpay_account_id 
           FROM vendors v
           LEFT JOIN linked_accounts la ON v.id = la.vendor_id
           WHERE v.tenant_id = $1
           ORDER BY v.created_at DESC`,
          [req.tenantId]
        );
        return vendorsQuery.rows;
      });

      return res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 4. Generates authorization redirect URL for Razorpay OAuth.
   */
  getOAuthUrl: async (req, res, next) => {
    const { vendorId } = req.query;
    if (!vendorId) {
      return res.status(400).json({ error: 'Vendor ID is required to connect via OAuth.' });
    }

    try {
      const clientId = process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey';
      const redirectUri = process.env.RAZORPAY_CALLBACK_URL || 'http://localhost:5000/api/v1/vendors/oauth/callback';
      const state = `${req.tenantId}:${vendorId}`;

      const isMock = !process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_mockkey');
      let authorizeUrl;

      if (isMock) {
        // Direct link to simulate OAuth success in mock mode
        authorizeUrl = `${redirectUri}?code=mock_code_${Date.now()}&state=${state}`;
      } else {
        authorizeUrl = `https://auth.razorpay.com/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read_write&state=${state}`;
      }

      return res.json({ authorizeUrl });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 5. Handles redirect callback from Razorpay OAuth authorization.
   */
  handleOAuthCallback: async (req, res, next) => {
    const { code, state } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/vendors?oauth=error&message=Missing+code+or+state`);
    }

    try {
      const [tenantId, vendorId] = state.split(':');
      if (!tenantId || !vendorId) {
        throw new Error('Invalid state payload');
      }

      const redirectUri = process.env.RAZORPAY_CALLBACK_URL || 'http://localhost:5000/api/v1/vendors/oauth/callback';
      const oauthResult = await razorpayService.exchangeOAuthCode(code, redirectUri);

      await runInTransaction(tenantId, async (client) => {
        // Verify vendor belongs to this tenant
        const vendorCheck = await client.query(
          'SELECT id FROM vendors WHERE tenant_id = $1 AND id = $2',
          [tenantId, vendorId]
        );

        if (vendorCheck.rows.length === 0) {
          throw new Error('Vendor does not exist under this tenant context');
        }

        // Update vendor KYC status to active
        await client.query(
          `UPDATE vendors SET kyc_status = 'active' WHERE id = $1`,
          [vendorId]
        );

        // Upsert linked account mapping
        await client.query(
          `INSERT INTO linked_accounts (vendor_id, tenant_id, razorpay_account_id, status, auth_token)
           VALUES ($1, $2, $3, 'active', $4)
           ON CONFLICT (razorpay_account_id) DO UPDATE 
             SET status = 'active', auth_token = EXCLUDED.auth_token`,
          [vendorId, tenantId, oauthResult.razorpay_account_id, oauthResult.access_token]
        );
      });

      return res.redirect(`${frontendUrl}/vendors?oauth=success`);
    } catch (err) {
      console.error('OAuth Callback Error:', err);
      return res.redirect(`${frontendUrl}/vendors?oauth=error&message=${encodeURIComponent(err.message)}`);
    }
  },

  /**
   * 6. Retrieves full profile of a specific vendor.
   */
  getVendorDetails: async (req, res, next) => {
    const { id } = req.params;
    try {
      const vendor = await runInTransaction(req.tenantId, async (client) => {
        const res = await client.query(
          `SELECT v.*, la.razorpay_account_id, la.status as linked_account_status
           FROM vendors v
           LEFT JOIN linked_accounts la ON v.id = la.vendor_id
           WHERE v.tenant_id = $1 AND v.id = $2`,
          [req.tenantId, id]
        );
        return res.rows[0];
      });

      if (!vendor) {
        return res.status(404).json({ error: 'Vendor not found.' });
      }

      return res.json(vendor);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 7. Computes outstanding unpaid balance for a vendor.
   */
  getVendorBalance: async (req, res, next) => {
    const { id } = req.params;
    try {
      const balanceVal = await runInTransaction(req.tenantId, async (client) => {
        const res = await client.query(
          `SELECT COALESCE(SUM(vendor_share), 0) as balance 
           FROM transfers 
           WHERE tenant_id = $1 AND status IN ('pending', 'processed') 
             AND linked_account_id = (SELECT id FROM linked_accounts WHERE vendor_id = $2)`,
          [req.tenantId, id]
        );
        return res.rows[0]?.balance || 0;
      });

      return res.json({ balance: parseFloat(balanceVal) });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 8. Lists split payment transfers associated with this vendor.
   */
  getVendorTransfers: async (req, res, next) => {
    const { id } = req.params;
    try {
      const transfers = await runInTransaction(req.tenantId, async (client) => {
        const res = await client.query(
          `SELECT t.*, d.document_number, d.created_at as invoice_date
           FROM transfers t
           JOIN documents d ON t.invoice_id = d.id
           WHERE t.tenant_id = $1 
             AND t.linked_account_id = (SELECT id FROM linked_accounts WHERE vendor_id = $2)
           ORDER BY t.created_at DESC`,
          [req.tenantId, id]
        );
        return res.rows;
      });

      return res.json(transfers);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 9. Safe deletion of vendor.
   */
  deleteVendor: async (req, res, next) => {
    const { id } = req.params;
    try {
      await runInTransaction(req.tenantId, async (client) => {
        const transfersCheck = await client.query(
          `SELECT 1 FROM transfers 
           WHERE tenant_id = $1 
             AND linked_account_id = (SELECT id FROM linked_accounts WHERE vendor_id = $2)
           LIMIT 1`,
          [req.tenantId, id]
        );

        if (transfersCheck.rows.length > 0) {
          throw new Error('Cannot delete vendor as transactions/transfers have already been recorded.');
        }

        await client.query('DELETE FROM vendors WHERE tenant_id = $1 AND id = $2', [req.tenantId, id]);
      });

      return res.json({ message: 'Vendor successfully removed.' });
    } catch (err) {
      next(err);
    }
  },

  processVendorPayout: async (req, res, next) => {
    const { id } = req.params;
    const { amount } = req.body;

    const payoutAmount = parseFloat(amount);
    if (isNaN(payoutAmount) || payoutAmount <= 0) {
      return res.status(400).json({ error: 'Payout amount must be a positive number.' });
    }

    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        const vendorRes = await client.query(
          `SELECT v.*, la.razorpay_account_id, la.id as linked_account_id
           FROM vendors v
           JOIN linked_accounts la ON v.id = la.vendor_id
           WHERE v.tenant_id = $1 AND v.id = $2`,
          [req.tenantId, id]
        );

        if (vendorRes.rows.length === 0) {
          throw Object.assign(new Error('Vendor not found or linked account not connected.'), { statusCode: 404 });
        }

        const vendor = vendorRes.rows[0];
        if (vendor.kyc_status !== 'active') {
          throw Object.assign(new Error('Vendor KYC must be active to process payouts.'), { statusCode: 400 });
        }

        const transfersRes = await client.query(
          `SELECT t.*, d.document_number
           FROM transfers t
           JOIN documents d ON t.invoice_id = d.id
           WHERE t.tenant_id = $1 AND t.linked_account_id = $2 AND t.status IN ('pending', 'processed')
           ORDER BY t.created_at ASC`,
          [req.tenantId, vendor.linked_account_id]
        );

        const totalAvailable = transfersRes.rows.reduce((sum, t) => sum + parseFloat(t.vendor_share), 0);
        if (payoutAmount > totalAvailable + 0.01) {
          throw Object.assign(new Error(`Requested payout (₹${payoutAmount.toFixed(2)}) exceeds outstanding balance (₹${totalAvailable.toFixed(2)}).`), { statusCode: 400 });
        }

        let remainingPayout = payoutAmount;
        const processedTransfers = [];

        for (const transfer of transfersRes.rows) {
          if (remainingPayout <= 0) break;

          const share = parseFloat(transfer.vendor_share);
          const payoutPart = Math.min(share, remainingPayout);

          const rzpTransfer = await razorpayService.createDirectTransfer(vendor.razorpay_account_id, payoutPart);

          await client.query(
            `UPDATE transfers SET status = 'settled', razorpay_transfer_id = $1 WHERE id = $2`,
            [rzpTransfer.id, transfer.id]
          );

          await postLedgerTransaction(
            client,
            req.tenantId,
            `Manual Vendor Payout: Invoice ${transfer.document_number}`,
            'vendor_payout',
            transfer.invoice_id,
            [
              { code: 'VENDOR_PAYABLE_DEFAULT', debit: payoutPart },
              { code: 'CASH_DEFAULT', credit: payoutPart }
            ]
          );

          remainingPayout -= payoutPart;
          processedTransfers.push({
            transferId: transfer.id,
            invoiceNumber: transfer.document_number,
            amount: payoutPart,
            rzpTransferId: rzpTransfer.id
          });
        }

        return processedTransfers;
      });

      return res.json({
        message: 'Vendor payouts processed and ledger reconciled successfully.',
        transfers: result
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  }
};

export default vendorController;
