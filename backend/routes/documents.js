import express from 'express';
import documentController from '../controllers/documentController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';
import { enforceLimit } from '../middleware/usageEnforcement.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireTenant);

// Document creation — enforcement is applied per document type inside the middleware
// The document type is determined from req.body.type at creation time
const enforceDocumentLimit = (req, res, next) => {
  const docType = req.body?.type;
  if (docType === 'invoice') {
    return enforceLimit('max_invoices_per_month', 'documents', {
      monthly: true,
      countFilter: "AND type = 'invoice'"
    })(req, res, next);
  }
  if (docType === 'quote') {
    return enforceLimit('max_quotes_per_month', 'documents', {
      monthly: true,
      countFilter: "AND type = 'quote'"
    })(req, res, next);
  }
  next();
};

// Collection routes
router.post('/', enforceDocumentLimit, documentController.createDocument);
router.get('/', documentController.getDocuments);
router.get('/stats', documentController.getDocumentStats);
router.get('/notifications', documentController.getNotificationCounts);


// Individual resource routes
router.get('/:id', documentController.getDocumentDetails);
router.patch('/:id/status', documentController.updateDocumentStatus);
router.post('/:id/convert', documentController.convertToInvoice);
router.delete('/:id', documentController.deleteDocument);
router.get('/:id/token', documentController.generateMagicToken);
router.post('/:id/send-email', documentController.sendDocumentEmail);

export default router;
