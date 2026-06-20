import { runInTransaction } from '../config/db.js';
import { sanitizeHtmlContent } from '../utils/sanitize.js';

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
  }
};

export default settingsController;
