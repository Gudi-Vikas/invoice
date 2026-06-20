import express from 'express';
import paymentController from '../controllers/paymentController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

// 1. Public OAuth callback (called by Razorpay OAuth redirection)
router.get('/razorpay/oauth/callback', paymentController.handleOAuthCallback);

// 2. Protected tenant routes
router.use(authenticateToken);
router.use(requireTenant);

router.get('/razorpay/oauth-url', paymentController.getOAuthUrl);
router.post('/razorpay/disconnect', paymentController.disconnectRazorpay);

export default router;
