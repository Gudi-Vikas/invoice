import { runInTransaction } from '../config/db.js';
import { sanitizeHtmlContent } from '../utils/sanitize.js';
import { isValidPhone, normalizePhone } from '../utils/validation.js';

/**
 * Controller for retrieving and updating tenant configuration blocks.
 * Enforces Row-Level Security via the runInTransaction database query wrapper.
 */
export const settingsController = {
  /**
   * 1. Fetches all settings blocks for the current tenant.
   */
  getSettings: async (req, res, next) => {
    try {
      const settings = await runInTransaction(req.tenantId, async (client) => {
        const result = await client.query(
          `SELECT general_config, business_info, invoice_config, tax_config, payments_config, email_templates, translations 
           FROM tenant_settings 
           WHERE tenant_id = $1`,
          [req.tenantId]
        );
        return result.rows[0];
      });

      if (!settings) {
        return res.status(404).json({ error: 'Tenant settings not found.' });
      }

      return res.json(settings);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 2. Updates settings for a specific category: general, business, invoice, tax, email, translations.
   * Runs XSS sanitization on rich text areas before database updates.
   */
  updateSettings: async (req, res, next) => {
    const { category } = req.params;
    const updatePayload = req.body;

    if (category === 'business' && updatePayload.phone) {
      if (!isValidPhone(updatePayload.phone)) {
        return res.status(400).json({ error: 'Please enter a valid contact phone number.' });
      }
    }

    try {
      const updatedValue = await runInTransaction(req.tenantId, async (client) => {
        // Lock row to prevent dirty reads during schema merge
        const settingsRes = await client.query(
          `SELECT general_config, business_info, invoice_config, tax_config, payments_config, email_templates, translations 
           FROM tenant_settings 
           WHERE tenant_id = $1 FOR UPDATE`,
          [req.tenantId]
        );

        if (settingsRes.rows.length === 0) {
          throw new Error('Settings not initialized.');
        }

        const current = settingsRes.rows[0];
        let targetColumn = '';
        let targetValue = null;

        switch (category) {
          case 'general':
            targetColumn = 'general_config';
            targetValue = { ...current.general_config, ...updatePayload };
            break;
          case 'business':
            targetColumn = 'business_info';
            // Sanitize business HTML info (bold tags, tables, tax registration inline tags) to prevent XSS injection
            if (updatePayload.extraInfo) {
              updatePayload.extraInfo = sanitizeHtmlContent(updatePayload.extraInfo);
            }
            targetValue = { ...current.business_info, ...updatePayload };
            break;
          case 'invoice':
            targetColumn = 'invoice_config';
            targetValue = { ...current.invoice_config, ...updatePayload };
            break;
          case 'tax':
            targetColumn = 'tax_config';
            targetValue = { ...current.tax_config, ...updatePayload };
            break;
          case 'payments':
            targetColumn = 'payments_config';
            targetValue = { ...current.payments_config, ...updatePayload };
            break;
          case 'email':
            targetColumn = 'email_templates';
            targetValue = { ...current.email_templates, ...updatePayload };
            break;
          case 'translations':
            targetColumn = 'translations';
            targetValue = { ...current.translations, ...updatePayload };
            break;
          default:
            return res.status(400).json({ error: `Invalid settings category: ${category}` });
        }

        await client.query(
          `UPDATE tenant_settings 
           SET ${targetColumn} = $1 
           WHERE tenant_id = $2`,
          [targetValue, req.tenantId]
        );

        if (category === 'business' && updatePayload.phone !== undefined) {
          await client.query(
            `UPDATE tenants SET phone = $1 WHERE id = $2`,
            [updatePayload.phone ? normalizePhone(updatePayload.phone) : null, req.tenantId]
          );
        }

        return targetValue;
      });

      return res.json({
        message: `${category.charAt(0).toUpperCase() + category.slice(1)} settings updated successfully.`,
        data: updatedValue
      });
    } catch (err) {
      next(err);
    }
  },

  uploadLogo: async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Logo image file is required.' });
    }

    const logoUrl = `${req.protocol}://${req.get('host')}/uploads/logos/${req.file.filename}`;

    try {
      const updatedValue = await runInTransaction(req.tenantId, async (client) => {
        const settingsRes = await client.query(
          `SELECT business_info
           FROM tenant_settings
           WHERE tenant_id = $1 FOR UPDATE`,
          [req.tenantId]
        );

        if (settingsRes.rows.length === 0) {
          throw new Error('Settings not initialized.');
        }

        const targetValue = {
          ...settingsRes.rows[0].business_info,
          logoUrl
        };

        await client.query(
          `UPDATE tenant_settings
           SET business_info = $1
           WHERE tenant_id = $2`,
          [targetValue, req.tenantId]
        );

        return targetValue;
      });

      return res.status(201).json({
        message: 'Business logo uploaded successfully.',
        logoUrl,
        data: updatedValue
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Generates Google OAuth authorization URL for connecting Gmail to send emails.
   */
  getGmailAuthUrl: async (req, res, next) => {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/settings/gmail/callback`;

      if (!clientId) {
        return res.status(400).json({
          error: 'Google OAuth Client ID is not configured on the server. Please check environment configuration.'
        });
      }

      const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email');
      const state = req.tenantId;

      const authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;

      return res.json({ authorizeUrl });
    } catch (err) {
      next(err);
    }
  },

  /**
   * OAuth Callback endpoint invoked by Google after user authorizes Gmail connection.
   */
  handleGmailCallback: async (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const { code, state: tenantId, error } = req.query;

    if (error || !code || !tenantId) {
      console.error('[Gmail OAuth Callback] Authorization error:', error || 'Missing code or tenant state');
      return res.redirect(`${frontendUrl}/settings?tab=emails&oauth=error&message=${encodeURIComponent(error || 'Authorization denied')}`);
    }

    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const requestPath = req.originalUrl ? req.originalUrl.split('?')[0] : '/api/settings/gmail/callback';
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}${requestPath}`;

      // Exchange code for access_token and refresh_token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.access_token) {
        console.error('[Gmail OAuth Callback] Failed to exchange code for token:', tokenData);
        return res.redirect(`${frontendUrl}/settings?tab=emails&oauth=error&message=${encodeURIComponent(tokenData.error_description || 'Failed to exchange authorization code')}`);
      }

      // Fetch user profile email address using access token
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json();
      const userEmail = userData.email || 'connected-user@gmail.com';

      // Persist refresh token & connection state in database under tenant settings
      await runInTransaction(tenantId, async (client) => {
        const settingsRes = await client.query(
          `SELECT email_templates FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE`,
          [tenantId]
        );

        if (settingsRes.rows.length === 0) {
          throw new Error('Tenant settings row not found.');
        }

        const currentTemplates = settingsRes.rows[0].email_templates || {};
        const updatedTemplates = {
          ...currentTemplates,
          smtp: {
            ...(currentTemplates.smtp || {}),
            provider: 'gmail_oauth',
            user: userEmail,
            fromName: currentTemplates.smtp?.fromName || userEmail.split('@')[0],
            gmailOAuth: {
              connected: true,
              userEmail: userEmail,
              refreshToken: tokenData.refresh_token || currentTemplates.smtp?.gmailOAuth?.refreshToken,
              connectedAt: new Date().toISOString()
            }
          }
        };

        await client.query(
          `UPDATE tenant_settings SET email_templates = $1 WHERE tenant_id = $2`,
          [updatedTemplates, tenantId]
        );
      });

      return res.redirect(`${frontendUrl}/settings?tab=emails&oauth=success`);
    } catch (err) {
      console.error('[Gmail OAuth Callback] Error persisting connection:', err);
      return res.redirect(`${frontendUrl}/settings?tab=emails&oauth=error&message=${encodeURIComponent(err.message || 'Server error saving OAuth connection')}`);
    }
  },

  /**
   * Disconnects Gmail OAuth connection for the current tenant.
   */
  disconnectGmail: async (req, res, next) => {
    try {
      await runInTransaction(req.tenantId, async (client) => {
        const settingsRes = await client.query(
          `SELECT email_templates FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE`,
          [req.tenantId]
        );

        if (settingsRes.rows.length === 0) {
          throw new Error('Settings not initialized.');
        }

        const currentTemplates = settingsRes.rows[0].email_templates || {};
        const updatedTemplates = {
          ...currentTemplates,
          smtp: {
            ...(currentTemplates.smtp || {}),
            provider: 'none',
            gmailOAuth: {
              connected: false,
              userEmail: null,
              refreshToken: null
            }
          }
        };

        await client.query(
          `UPDATE tenant_settings SET email_templates = $1 WHERE tenant_id = $2`,
          [updatedTemplates, req.tenantId]
        );
      });

      return res.json({ message: 'Gmail account disconnected successfully.' });
    } catch (err) {
      next(err);
    }
  }
};

export default settingsController;

