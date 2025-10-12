// src/routes/shows.ts
import express from 'express';
import axios from 'axios';
import Stripe from 'stripe';
import { logger } from '../utils/logger';

const router = express.Router();

const SEATGEEK_API_BASE = 'https://api.seatgeek.com/2';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-08-27.basil' }); // Use latest API version

const verifyApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const expectedApiKey = process.env.TICKET_API_KEY;

  if (!expectedApiKey) {
    logger.error('TICKET_API_KEY not configured');
    return res.status(500).json({ success: false, error: 'Configuration Error', message: 'TICKET_API_KEY not configured' });
  }
  if (!apiKey || apiKey !== expectedApiKey) {
    logger.warn('Unauthorized access attempt', { apiKey });
    return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Invalid API key' });
  }
  next();
};

// Fetch events directly from SeatGeek API
router.get('/', verifyApiKey, async (req, res) => {
  try {
    const clientId = process.env.SEATGEEK_CLIENT_ID;
    if (!clientId) {
      logger.error('SeatGeek CLIENT_ID missing');
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const queryParams: any = { client_id: clientId, ...req.query };

    logger.info('Fetching events from SeatGeek', { params: queryParams });
    
    const response = await axios.get(`${SEATGEEK_API_BASE}/events`, {
      params: queryParams,
      timeout: 10000,
      headers: { 'User-Agent': 'TicketSnipper/1.0' }, // Identify your app
    });

    logger.info(`SeatGeek Response: ${response.data.events?.length || 0} events found`);

    res.json({ success: true, data: response.data, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Failed to fetch shows', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch shows', message: (error as Error).message });
  }
});

// Fetch single event directly from SeatGeek API
router.get('/:id', verifyApiKey, async (req, res) => {
  try {
    const clientId = process.env.SEATGEEK_CLIENT_ID;
    if (!clientId) {
      logger.error('SeatGeek CLIENT_ID missing');
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { id } = req.params;
    
    logger.info(`Fetching event details for ID: ${id}`);
    
    const response = await axios.get(`${SEATGEEK_API_BASE}/events/${id}`, {
      params: { client_id: clientId },
      timeout: 5000,
      headers: { 'User-Agent': 'TicketSnipper/1.0' },
    });

    logger.info(`Event found: ${response.data.title || response.data.short_title}`);

    res.json({ success: true, data: response.data, timestamp: new Date().toISOString() });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Show not found', message: `No event found with ID: ${req.params.id}` });
    }
    logger.error('Failed to fetch show', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch show', message: (error as Error).message });
  }
});

// Reserve endpoint with Stripe integration
router.post('/:id/reserve', verifyApiKey, async (req, res) => {
  try {
    const clientId = process.env.SEATGEEK_CLIENT_ID;
    if (!clientId) {
      logger.error('SeatGeek CLIENT_ID missing');
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { id } = req.params;
    const { quantity = 1, price, userEmail, userName } = req.body;

    if (!price || price <= 0) {
      return res.status(400).json({ success: false, error: 'Price required', message: 'Price must be provided in the request body' });
    }
    if (!userEmail || !userName) {
      return res.status(400).json({ success: false, error: 'User details required', message: 'userEmail and userName must be provided' });
    }

    const eventResponse = await axios.get(`${SEATGEEK_API_BASE}/events/${id}`, {
      params: { client_id: clientId },
      timeout: 5000,
      headers: { 'User-Agent': 'TicketSnipper/1.0' },
    });

    const event = eventResponse.data;

    const seatId = `SEAT-${id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const reservationId = `RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: event.title || event.short_title,
          },
          unit_amount: Math.round(price * 100), // Convert to cents
        },
        quantity,
      }],
      mode: 'payment',
      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
      customer_email: userEmail,
      metadata: {
        reservationId,
        eventId: id,
        seatId,
        userName,
      },
    });

    logger.info(`Stripe Checkout Session created: ${session.id}`);

    res.json({
      success: true,
      reservationId,
      eventId: id,
      eventTitle: event.title || event.short_title,
      quantity,
      totalPrice: price * quantity,
      pricePerTicket: price,
      seatId,
      checkoutUrl: session.url,
      sessionId: session.id,
      message: 'Checkout session created',
      eventData: event,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Event not found', message: `No event with ID: ${req.params.id}` });
    }
    logger.error('Reservation failed', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Reservation failed', message: (error as Error).message });
  }
});

// Confirm reservation (e.g., after Stripe payment webhook)
router.post('/:id/confirm', verifyApiKey, async (req, res) => {
  try {
    const clientId = process.env.SEATGEEK_CLIENT_ID;
    if (!clientId) {
      logger.error('SeatGeek CLIENT_ID missing');
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { id } = req.params;
    const { reservationId, paymentIntentId } = req.body;

    if (!reservationId || !paymentIntentId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Required fields missing', 
        message: 'reservationId and paymentIntentId must be provided' 
      });
    }

    // Verify event exists
    const eventResponse = await axios.get(`${SEATGEEK_API_BASE}/events/${id}`, {
      params: { client_id: clientId },
      timeout: 5000,
      headers: { 'User-Agent': 'TicketSnipper/1.0' },
    });

    const event = eventResponse.data;

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        success: false, 
        error: 'Payment not successful', 
        message: 'Payment intent not completed' 
      });
    }

    // In a production environment, update a database with confirmed status
    logger.info(`Confirmed reservation ${reservationId} for event ${id}`);

    res.json({
      success: true,
      reservationId,
      eventId: id,
      eventTitle: event.title || event.short_title,
      status: 'confirmed',
      message: 'Reservation confirmed successfully',
      eventData: event,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Event not found', message: `No event with ID: ${req.params.id}` });
    }
    logger.error('Reservation confirmation failed', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Reservation confirmation failed', message: (error as Error).message });
  }
});

export default router;