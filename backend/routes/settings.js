import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import settingsController from '../controllers/settingsController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

const logoUploadDir = path.resolve('uploads/logos');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(logoUploadDir, { recursive: true });
    cb(null, logoUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${req.tenantId}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files can be uploaded as logos.'));
      return;
    }
    cb(null, true);
  }
});

// Apply auth middleware to protect settings routes
router.use(authenticateToken);
router.use(requireTenant);

router.get('/', settingsController.getSettings);
router.post('/logo', upload.single('logo'), settingsController.uploadLogo);
router.put('/:category', settingsController.updateSettings);

export default router;
