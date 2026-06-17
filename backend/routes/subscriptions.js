import express from 'express';
import subscriptionController from '../controllers/subscriptionController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

// Get available subscription packages (public to authenticated users)
router.get('/plans', authenticateToken, subscriptionController.getPlans);

// Initialize a checkout session (restricted to tenant context admin/billing roles)
router.post('/checkout', authenticateToken, requireTenant, subscriptionController.initializeCheckout);

export default router;
