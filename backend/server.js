import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import errorHandler from './middleware/errorHandler.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { initNotificationService } from './services/notificationService.js';

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
import paymentRoutes from './routes/payments.js';
import notificationRoutes from './routes/notifications.js';

dotenv.config();

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is missing.");
}

const app = express();
const PORT = process.env.PORT || 5000;

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', (socket) => {
  if (socket.user.tenantId) {
    socket.join(`tenant_${socket.user.tenantId}`);
  }
  // Master admins have a permissions property or explicit role we could check, or we can just check if they lack tenantId and are master
  // We'll rely on the frontend passing the correct token and if they don't have a tenantId they are usually master admins.
  if (!socket.user.tenantId) {
    socket.join('master');
  }

  socket.on('disconnect', () => {
    // console.log('Socket disconnected');
  });
});

initNotificationService(io);

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
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Webhook listener endpoints
app.use('/api/webhooks', webhookRoutes);

// Mount global error handler (must be placed at the end of the middleware stack)
app.use(errorHandler);

app.get("/", (req, res) => {
  res.send("Backend running");
});

httpServer.listen(PORT, () => {
  console.log(`[Invoice SaaS Server] Server running on port ${PORT}`);
});