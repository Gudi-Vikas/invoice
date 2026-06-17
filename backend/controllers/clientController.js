import { runInTransaction } from '../config/db.js';

/**
 * Controller for managing client contacts for invoice and quotation routing.
 * All queries run within runInTransaction to enforce tenant RLS isolation.
 */
export const clientController = {
  /**
   * 1. Register a new client under the tenant's namespace.
   */
  createClient: async (req, res, next) => {
    const { name, email, billingAddress, extraInfo } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Client name and email address are required.' });
    }

    try {
      const newClient = await runInTransaction(req.tenantId, async (client) => {
        const insertRes = await client.query(
          `INSERT INTO clients (tenant_id, name, email, billing_address, extra_info)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, email, billing_address, extra_info, created_at`,
          [req.tenantId, name, email, billingAddress || '{}', extraInfo || null]
        );
        return insertRes.rows[0];
      });

      return res.status(201).json({
        message: 'Client profile registered successfully.',
        data: newClient
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 2. Lists clients under the tenant, supporting server-side pagination and search.
   */
  getClients: async (req, res, next) => {
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 50, 10);
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        let sql = `
          SELECT id, name, email, billing_address, extra_info, created_at
          FROM clients
          WHERE tenant_id = $1
        `;
        const params = [req.tenantId];

        if (search) {
          params.push(`%${search}%`);
          sql += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        const dataQuery = await client.query(sql, [...params, limit, offset]);

        // Count query
        let countSql = 'SELECT COUNT(*) as count FROM clients WHERE tenant_id = $1';
        const countParams = [req.tenantId];
        if (search) {
          countParams.push(`%${search}%`);
          countSql += ` AND (name ILIKE $${countParams.length} OR email ILIKE $${countParams.length})`;
        }
        const countQuery = await client.query(countSql, countParams);
        const totalCount = parseInt(countQuery.rows[0].count, 10);

        return {
          clients: dataQuery.rows,
          totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit)
        };
      });

      return res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 3. Retrieves a single client by ID.
   */
  getClientById: async (req, res, next) => {
    const { id } = req.params;

    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        const res = await client.query(
          `SELECT id, name, email, billing_address, extra_info, created_at
           FROM clients
           WHERE tenant_id = $1 AND id = $2`,
          [req.tenantId, id]
        );
        return res.rows[0] || null;
      });

      if (!result) {
        return res.status(404).json({ error: 'Client not found.' });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 4. Updates client profile fields.
   */
  updateClient: async (req, res, next) => {
    const { id } = req.params;
    const { name, email, billingAddress, extraInfo } = req.body;

    try {
      const updated = await runInTransaction(req.tenantId, async (client) => {
        const updateRes = await client.query(
          `UPDATE clients
           SET name = COALESCE($1, name),
               email = COALESCE($2, email),
               billing_address = COALESCE($3, billing_address),
               extra_info = COALESCE($4, extra_info)
           WHERE tenant_id = $5 AND id = $6
           RETURNING id, name, email, billing_address, extra_info, created_at`,
          [name, email, billingAddress ? JSON.stringify(billingAddress) : null, extraInfo, req.tenantId, id]
        );
        return updateRes.rows[0] || null;
      });

      if (!updated) {
        return res.status(404).json({ error: 'Client not found or access denied.' });
      }

      return res.json({ message: 'Client updated successfully.', data: updated });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 5. Returns document summary (invoices + quotes) for a specific client.
   */
  getClientDocuments: async (req, res, next) => {
    const { id } = req.params;

    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        const docRes = await client.query(
          `SELECT id, type, document_number, status, total_due, due_date, created_at
           FROM documents
           WHERE tenant_id = $1 AND client_id = $2
           ORDER BY created_at DESC`,
          [req.tenantId, id]
        );
        return docRes.rows;
      });

      return res.json({ documents: result, clientId: id });
    } catch (err) {
      next(err);
    }
  }
};

export default clientController;
