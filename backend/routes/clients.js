import express from 'express';
import clientController from '../controllers/clientController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireTenant);

// Collection routes
router.post('/', clientController.createClient);
router.get('/', clientController.getClients);

// Individual resource routes
router.get('/:id', clientController.getClientById);
router.put('/:id', clientController.updateClient);
router.get('/:id/documents', clientController.getClientDocuments);

export default router;
