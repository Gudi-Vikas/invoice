import dotenv from 'dotenv';
dotenv.config();
import { initNotificationService } from './services/notificationService.js';
import eventBus from './services/eventBus.js';

initNotificationService(null);
eventBus.emit('document.created', { tenantId: '13a4b9ee-89d4-42b3-aee3-568ea46cb844', type: 'quote', documentNumber: 'TEST-001', documentId: 'test-123' });
setTimeout(() => {
  console.log("Done");
  process.exit(0);
}, 2000);
