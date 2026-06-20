import { runInTransaction } from '../config/db.js';
import razorpayService from '../services/razorpayService.js';

export const paymentController = {
  /**
   * Generates authorization redirect URL for Tenant Razorpay OAuth connection.
   */
  getOAuthUrl: async (req, res, next) => {
    try {
      const clientId = process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey';
      
      // Build callback dynamically so it works in both dev (localhost) and production
      const redirectUri = `${req.protocol}://${req.get('host')}/api/v1/payments/razorpay/oauth/callback`;
      const state = `tenant:${req.tenantId}`;

      const isMock = !process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_mockkey');
      let authorizeUrl;

      if (isMock) {
        // Direct link to simulate OAuth success in mock mode
        authorizeUrl = `${redirectUri}?code=mock_tenant_code_${Date.now()}&state=${state}`;
      } else {
        authorizeUrl = `https://auth.razorpay.com/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read_write&state=${state}`;
      }

      return res.json({ authorizeUrl });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Handles direct redirect callback from Razorpay OAuth authorization.
   * Updates settings with access token and connected account status.
   */
  handleOAuthCallback: async (req, res, next) => {
    const { code, state } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/settings?tab=payments&oauth=error&message=Missing+code+or+state`);
    }

    try {
      const [type, tenantId] = state.split(':');
      if (type !== 'tenant' || !tenantId) {
        throw new Error('Invalid state payload');
      }

      const redirectUri = `${req.protocol}://${req.get('host')}/api/v1/payments/razorpay/oauth/callback`;
      const oauthResult = await razorpayService.exchangeOAuthCode(code, redirectUri);

      await runInTransaction(tenantId, async (client) => {
        // Retrieve current settings
        const settingsRes = await client.query(
          `SELECT payments_config FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE`,
          [tenantId]
        );

        if (settingsRes.rows.length === 0) {
          throw new Error('Tenant settings not initialized.');
        }

        const currentPayments = settingsRes.rows[0].payments_config || {};
        const updatedPayments = {
          ...currentPayments,
          razorpayConnected: true,
          razorpayKeyId: oauthResult.razorpay_account_id,
          razorpayAccessToken: oauthResult.access_token
        };

        await client.query(
          `UPDATE tenant_settings SET payments_config = $1 WHERE tenant_id = $2`,
          [updatedPayments, tenantId]
        );
      });

      return res.redirect(`${frontendUrl}/settings?tab=payments&oauth=success`);
    } catch (err) {
      console.error('[Tenant OAuth Callback Error]:', err);
      return res.redirect(`${frontendUrl}/settings?tab=payments&oauth=error&message=${encodeURIComponent(err.message)}`);
    }
  },

  /**
   * Disconnects the tenant's Razorpay OAuth connection, clearing credentials.
   */
  disconnectRazorpay: async (req, res, next) => {
    try {
      await runInTransaction(req.tenantId, async (client) => {
        const settingsRes = await client.query(
          `SELECT payments_config FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE`,
          [req.tenantId]
        );

        if (settingsRes.rows.length === 0) {
          throw new Error('Tenant settings not initialized.');
        }

        const currentPayments = settingsRes.rows[0].payments_config || {};
        
        // Remove connected properties
        const { razorpayConnected, razorpayKeyId, razorpayAccessToken, ...remainingPayments } = currentPayments;
        const updatedPayments = {
          ...remainingPayments,
          razorpayConnected: false
        };

        await client.query(
          `UPDATE tenant_settings SET payments_config = $1 WHERE tenant_id = $2`,
          [updatedPayments, req.tenantId]
        );
      });

      return res.json({ message: 'Razorpay payment integration disconnected successfully.' });
    } catch (err) {
      next(err);
    }
  }
};

export default paymentController;
