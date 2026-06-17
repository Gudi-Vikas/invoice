import express from 'express';
import documentController from '../controllers/documentController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireTenant);

// Collection routes
router.post('/', documentController.createDocument);
router.get('/', documentController.getDocuments);

// Individual resource routes
router.get('/:id', documentController.getDocumentDetails);
router.patch('/:id/status', documentController.updateDocumentStatus);
router.delete('/:id', documentController.deleteDocument);
router.get('/:id/token', documentController.generateMagicToken);

export default router;
