import { runInTransaction } from '../config/db.js';
import razorpayService from '../services/razorpayService.js';

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
  }
};

export default vendorController;
