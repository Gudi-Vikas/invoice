import express from 'express';
import portalController from '../controllers/portalController.js';

const router = express.Router();

// Publicly-accessible endpoints (rely on JWT magic link token verification in payloads/parameters)
router.get('/documents/:token', portalController.getDocumentByToken);
router.post('/quotes/:id/accept', portalController.acceptQuote);
router.post('/quotes/:id/decline', portalController.declineQuote);
router.post('/invoices/:id/pay', portalController.initializePayment);
router.post('/invoices/:id/verify', portalController.verifyPayment);
router.post('/invoices/:id/verify-offline', portalController.verifyOfflinePayment);

export default router;
