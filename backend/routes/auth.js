import express from 'express';
import authController from '../controllers/authController.js';
import { authenticateToken, requireTenant, checkRole } from '../middleware/auth.js';

const router = express.Router();

// ── Public ──────────────────────────────────────────────────────────────────
// Create a new tenant + admin user (owner onboarding)
router.post('/signup', authController.signup);

// Authenticate and receive a JWT (+ allTenants list for tenant picker)
router.post('/login', authController.login);

// Redeem an invite token → join an existing tenant workspace
router.post('/join', authController.join);

// ── Authenticated (any valid JWT, no specific tenant needed) ─────────────────
// Re-issue JWT scoped to a different tenant the user belongs to
router.post('/switch-tenant', authenticateToken, authController.switchTenant);

// Create a new tenant workspace for the logged-in user
router.post('/create-tenant', authenticateToken, authController.createTenant);

// ── Admin-only (must carry x-tenant-id + be an admin of that tenant) ─────────
// Create a one-time invite token for a given email + role
router.post('/invite', authenticateToken, requireTenant, checkRole(['admin']), authController.invite);

// Get list of all users in the active tenant workspace
router.get('/users', authenticateToken, requireTenant, authController.listUsers);

export default router;
