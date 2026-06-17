import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import errorHandler from './middleware/errorHandler.js';

// Route Imports
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import clientRoutes from './routes/clients.js';
import documentRoutes from './routes/documents.js';
import vendorRoutes from './routes/vendors.js';
import portalRoutes from './routes/portal.js';
import webhookRoutes from './routes/webhooks.js';
import subscriptionRoutes from './routes/subscriptions.js';
import masterRoutes from './routes/master.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Cross-Origin Resource Sharing
app.use(cors());

// Configure JSON body parser to capture the raw body buffer.
// The raw buffer is required for cryptographically verifying Razorpay webhook signatures.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf ? buf.toString() : '';
  }
}));

app.use(express.urlencoded({ extended: true }));

// Serve static assets (uploads and logo assets)
app.use('/uploads', express.static('uploads'));

// Healthcheck endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Bind API route endpoints
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/clients', clientRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/vendors', vendorRoutes);
app.use('/api/v1/portal', portalRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/master', masterRoutes);  // Platform Owner Control Plane

// Webhook listener endpoints
app.use('/api/webhooks', webhookRoutes);

// Mount global error handler (must be placed at the end of the middleware stack)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Invoice SaaS Server] Server running on port ${PORT}`);
});