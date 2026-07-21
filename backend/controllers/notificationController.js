import pool from '../config/db.js';

// Get notifications for a user/tenant (paginated)
export const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query;
    let params;

    // Master Admins (tenantId is undefined/null)
    if (!req.tenantId) {
      query = `
        SELECT * FROM notifications 
        WHERE tenant_id IS NULL
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;
      params = [limit, offset];
    } else {
      // Tenant Users
      query = `
        SELECT * FROM notifications 
        WHERE tenant_id = $1 
        AND (user_id = $2 OR user_id IS NULL)
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
      `;
      params = [req.tenantId, req.user.id, limit, offset];
    }

    const result = await pool.query(query, params);

    // Get unread count
    let countQuery;
    let countParams;
    if (!req.tenantId) {
      countQuery = `SELECT COUNT(*) FROM notifications WHERE tenant_id IS NULL AND is_read = false`;
      countParams = [];
    } else {
      countQuery = `SELECT COUNT(*) FROM notifications WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL) AND is_read = false`;
      countParams = [req.tenantId, req.user.id];
    }

    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      notifications: result.rows,
      unreadCount: parseInt(countResult.rows[0].count, 10)
    });
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || null;

    let query = `UPDATE notifications SET is_read = true WHERE id = $1`;
    let params = [id];

    if (tenantId) {
       query += ` AND tenant_id = $2`;
       params.push(tenantId);
    } else {
       query += ` AND tenant_id IS NULL`;
    }

    query += ` RETURNING *`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (req, res, next) => {
  try {
    const tenantId = req.tenantId || null;

    let query;
    let params;

    if (tenantId) {
      query = `UPDATE notifications SET is_read = true WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL)`;
      params = [tenantId, req.user.id];
    } else {
      query = `UPDATE notifications SET is_read = true WHERE tenant_id IS NULL`;
      params = [];
    }

    await pool.query(query, params);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || null;

    let query = `DELETE FROM notifications WHERE id = $1`;
    let params = [id];

    if (tenantId) {
       query += ` AND tenant_id = $2`;
       params.push(tenantId);
    } else {
       query += ` AND tenant_id IS NULL`;
    }

    query += ` RETURNING *`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const deleteAllNotifications = async (req, res, next) => {
  try {
    const tenantId = req.tenantId || null;

    let query;
    let params;

    if (tenantId) {
      query = `DELETE FROM notifications WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL)`;
      params = [tenantId, req.user.id];
    } else {
      query = `DELETE FROM notifications WHERE tenant_id IS NULL`;
      params = [];
    }

    await pool.query(query, params);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
