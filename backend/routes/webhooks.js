import express from 'express';
import webhookController from '../controllers/webhookController.js';

const router = express.Router();

// Public webhook receiver (authenticity verified internally via cryptographic signatures)
router.post('/razorpay', webhookController.handleWebhook);

export default router;
