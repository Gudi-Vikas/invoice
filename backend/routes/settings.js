import express from 'express';
import settingsController from '../controllers/settingsController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

// Apply auth middleware to protect settings routes
router.use(authenticateToken);
router.use(requireTenant);

router.get('/', settingsController.getSettings);
router.put('/:category', settingsController.updateSettings);

export default router;
