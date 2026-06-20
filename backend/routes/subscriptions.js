import express from 'express';
import subscriptionController from '../controllers/subscriptionController.js';
import { authenticateToken, requireTenant, checkRole } from '../middleware/auth.js';

const router = express.Router();

// Get available subscription packages (public to authenticated users)
router.get('/plans', authenticateToken, subscriptionController.getPlans);
router.get('/status', authenticateToken, requireTenant, subscriptionController.getStatus);

// Get platform billing invoices (restricted to tenant context admin/billing roles)
router.get('/invoices', authenticateToken, requireTenant, checkRole(['admin', 'billing','member']), subscriptionController.getTenantInvoices);

// Initialize a checkout session (restricted to tenant context admin/billing roles)
router.post('/checkout', authenticateToken, requireTenant, checkRole(['admin', 'billing','member']), subscriptionController.initializeCheckout);
router.post('/verify', authenticateToken, requireTenant, checkRole(['admin', 'billing','member']), subscriptionController.verifyCheckout);

// Pay platform billing invoices (restricted to tenant context admin/billing roles)
router.post('/pay-invoice/:invoiceId', authenticateToken, requireTenant, checkRole(['admin', 'billing','member']), subscriptionController.initializeInvoicePayment);
router.post('/verify-invoice', authenticateToken, requireTenant, checkRole(['admin','billing','member']), subscriptionController.verifyInvoicePayment);

export default router;
