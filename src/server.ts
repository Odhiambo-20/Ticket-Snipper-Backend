// src/server.ts
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import paymentRoutes from './routes/payments';
import showsRoutes from './routes/shows';

dotenv.config();

const app = express();
const logger = require('./utils/logger').logger;

// CORS configuration
app.use(cors({ origin: process.env.ALLOWED_ORIGINS === '*' ? true : (origin, callback) => callback(null, true), credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ignore favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Ticket Sniper API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    integrations: {
      seatgeek: process.env.SEATGEEK_CLIENT_ID ? 'configured' : 'not configured',
      stripe: process.env.STRIPE_SECRET_KEY ? 'configured' : 'not configured',
    },
  });
});

// API Routes
app.use('/api/payments', paymentRoutes);
app.use('/api/shows', showsRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Ticket Sniper API', version: '1.0.0', documentation: '/health', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.path} not found` });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response) => {
  logger.error('Server error', { message: err.message, stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined });
  res.status(500).json({ error: 'Internal server error', message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message });
});

export default app;

// Local development server
if (process.env.NODE_ENV !== 'production') {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on http://0.0.0.0:${PORT}`);
  });
}