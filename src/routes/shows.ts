// src/routes/shows.ts
import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger';

const router = express.Router();

const SEATGEEK_API_BASE = 'https://api.seatgeek.com/2';

const verifyApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const expectedApiKey = process.env.TICKET_API_KEY;

  if (!expectedApiKey) {
    return res.status(500).json({ success: false, error: 'Configuration Error', message: 'TICKET_API_KEY not configured' });
  }
  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Invalid API key' });
  }
  next();
};

// Fetch events directly from SeatGeek API
router.get('/', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    // Pass through query parameters to SeatGeek
    const queryParams: any = {
      client_id: process.env.SEATGEEK_CLIENT_ID,
      ...req.query
    };

    logger.info('Fetching events from SeatGeek', { params: queryParams });
    
    const response = await axios.get(
      `${SEATGEEK_API_BASE}/events`,
      {
        params: queryParams,
        timeout: 10000,
      }
    );

    logger.info(`SeatGeek Response: ${response.data.events?.length || 0} events found`);

    // Return authentic SeatGeek response
    res.json({ 
      success: true, 
      data: response.data,
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    logger.error('Failed to fetch shows', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch shows', message: (error as Error).message });
  }
});

// Fetch single event directly from SeatGeek API
router.get('/:id', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { id } = req.params;
    
    logger.info(`Fetching event details for ID: ${id}`);
    
    const response = await axios.get(
      `${SEATGEEK_API_BASE}/events/${id}`, 
      {
        params: { 
          client_id: process.env.SEATGEEK_CLIENT_ID,
        },
        timeout: 5000,
      }
    );

    logger.info(`Event found: ${response.data.title || response.data.short_title}`);

    // Return authentic SeatGeek response
    res.json({ 
      success: true, 
      data: response.data,
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Show not found', message: `No event found with ID: ${req.params.id}` });
    }
    logger.error('Failed to fetch show', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch show', message: (error as Error).message });
  }
});

// Reserve endpoint - uses SeatGeek data for checkout
router.post('/:id/reserve', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { id } = req.params;
    const { quantity = 1, price } = req.body;
    
    // Fetch event from SeatGeek
    const response = await axios.get(
      `${SEATGEEK_API_BASE}/events/${id}`, 
      {
        params: { 
          client_id: process.env.SEATGEEK_CLIENT_ID,
        },
        timeout: 5000,
      }
    );

    const event = response.data;

    // Validate that price is provided
    if (!price || price <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Price required', 
        message: 'Price must be provided in the request body' 
      });
    }

    // Generate IDs
    const seatId = `SEAT-${id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const reservationId = `RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Try to create checkout session, but don't fail if it's not available
    let checkoutUrl = null;
    let sessionId = null;
    
    try {
      const checkoutResponse = await axios.post(
        `${req.protocol}://${req.get('host')}/api/payments/stripe/create-checkout-session`,
        { 
          eventId: id, 
          seatId, 
          quantity, 
          eventTitle: event.title || event.short_title, 
          price: price
        },
        { 
          headers: { 'x-api-key': process.env.TICKET_API_KEY }, 
          timeout: 5000,
          validateStatus: (status) => status < 500 // Don't throw on 4xx errors
        }
      );

      const checkoutData = checkoutResponse.data as { 
        success: boolean; 
        checkoutUrl?: string; 
        sessionId?: string; 
        message?: string 
      };
      
      if (checkoutData.success && checkoutData.checkoutUrl) {
        checkoutUrl = checkoutData.checkoutUrl;
        sessionId = checkoutData.sessionId;
      } else {
        logger.warn('Checkout session creation failed', { message: checkoutData.message });
      }
    } catch (checkoutError) {
      logger.warn('Checkout endpoint unavailable', { error: (checkoutError as Error).message });
    }

    res.json({
      success: true,
      reservationId,
      eventId: id,
      eventTitle: event.title || event.short_title,
      quantity,
      totalPrice: price * quantity,
      pricePerTicket: price,
      seatId,
      checkoutUrl,
      sessionId,
      message: checkoutUrl ? 'Checkout session created' : 'Reservation created - checkout unavailable',
      eventData: event, // Include full SeatGeek event data
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ 
        success: false, 
        error: 'Event not found', 
        message: `No event with ID: ${req.params.id}` 
      });
    }
    logger.error('Reservation failed', { error: (error as Error).message });
    res.status(500).json({ 
      success: false, 
      error: 'Reservation failed', 
      message: (error as Error).message 
    });
  }
});

export default router;