// src/routes/shows.ts
import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger';

const router = express.Router();

const SEATGEEK_API_BASE = 'https://api.seatgeek.com/2';

interface SeatGeekEvent {
  id: number;
  title: string;
  type: string;
  datetime_local: string;
  venue: { name: string; city: string; state: string };
  performers: { name: string; image: string; primary: boolean }[];
  short_title: string;
  url: string;
  stats?: { listing_count?: number; lowest_price?: number; average_price?: number; highest_price?: number };
}

interface Show {
  id: string;
  title: string;
  artist: string;
  date: string;
  venue: string;
  city: string;
  saleTime: string;
  availableSeats: number;
  price: number;
  sections: string[];
  imageUrl?: string;
  eventUrl?: string;
  isAvailable: boolean;
}

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

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const formatTime = (dateString: string): string => {
  return new Date(dateString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

// API CALL 1: Fetch events with city filter
const fetchEventsByCity = async (location: string, perPage: number = 100): Promise<SeatGeekEvent[]> => {
  try {
    logger.info('API CALL 1: Fetching events by city', { location, perPage });
    
    const response = await axios.get<{ events: SeatGeekEvent[]; meta: { total: number } }>(
      `${SEATGEEK_API_BASE}/events`,
      {
        params: {
          client_id: process.env.SEATGEEK_CLIENT_ID,
          'venue.city': location,
          per_page: perPage,
          sort: 'datetime_local.asc',
          'datetime_local.gte': new Date().toISOString(),
        },
        timeout: 10000,
      }
    );

    logger.info(`API CALL 1 Response: ${response.data.events.length} events found`);
    return response.data.events;
  } catch (error) {
    logger.error('API CALL 1 failed', { error: (error as Error).message });
    return [];
  }
};

// API CALL 2: Fetch general events
const fetchGeneralEvents = async (perPage: number = 100): Promise<SeatGeekEvent[]> => {
  try {
    logger.info('API CALL 2: Fetching general events', { perPage });
    
    const response = await axios.get<{ events: SeatGeekEvent[]; meta: { total: number } }>(
      `${SEATGEEK_API_BASE}/events`,
      {
        params: {
          client_id: process.env.SEATGEEK_CLIENT_ID,
          per_page: perPage,
        },
        timeout: 10000,
      }
    );

    logger.info(`API CALL 2 Response: ${response.data.events.length} events found`);
    return response.data.events;
  } catch (error) {
    logger.error('API CALL 2 failed', { error: (error as Error).message });
    return [];
  }
};

// Combine both API calls and return ALL unique events
const fetchAllEvents = async (location?: string): Promise<SeatGeekEvent[]> => {
  const allEvents: SeatGeekEvent[] = [];
  const uniqueEventIds = new Set<number>();

  // API CALL 1: City-filtered events
  if (location) {
    const cityEvents = await fetchEventsByCity(location, 100);
    for (const event of cityEvents) {
      if (!uniqueEventIds.has(event.id)) {
        allEvents.push(event);
        uniqueEventIds.add(event.id);
      }
    }
  }

  // API CALL 2: General events
  const generalEvents = await fetchGeneralEvents(100);
  for (const event of generalEvents) {
    if (!uniqueEventIds.has(event.id)) {
      allEvents.push(event);
      uniqueEventIds.add(event.id);
    }
  }

  logger.info(`Total unique events from SeatGeek: ${allEvents.length}`);
  return allEvents;
};

router.get('/', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { location = 'New York', fetch_all = 'true' } = req.query;
    let events: SeatGeekEvent[] = [];

    logger.info('=== FETCHING ALL EVENTS FROM SEATGEEK ===');

    if (fetch_all === 'true') {
      events = await fetchAllEvents(location as string);
    } else {
      events = await fetchEventsByCity(location as string, 25);
    }

    logger.info(`Processing ${events.length} events from SeatGeek API`);

    // Map ALL events - display exactly what SeatGeek returns
    const shows: Show[] = events.map((event) => {
      const primaryPerformer = event.performers.find((p) => p.primary) || event.performers[0] || { name: 'Various Artists', image: '' };
      
      // Get stats if they exist, use actual values from API
      const listingCount = event.stats?.listing_count ?? 0;
      const lowestPrice = event.stats?.lowest_price ?? 0;
      const averagePrice = event.stats?.average_price ?? 0;
      const price = lowestPrice || averagePrice;

      return {
        id: event.id.toString(),
        title: event.title || event.short_title || 'Untitled Event',
        artist: primaryPerformer.name,
        date: formatDate(event.datetime_local),
        venue: event.venue?.name || 'Unknown Venue',
        city: `${event.venue?.city || 'Unknown'}, ${event.venue?.state || ''}`,
        saleTime: formatTime(event.datetime_local),
        availableSeats: listingCount,
        price: price > 0 ? Math.round(price) : 0,
        sections: ['General Admission'],
        imageUrl: primaryPerformer.image || '',
        eventUrl: event.url || '',
        isAvailable: listingCount > 0 && price > 0,
      };
    });

    logger.info(`Returning ${shows.length} shows from SeatGeek`);

    res.json({ 
      success: true, 
      shows, 
      total: shows.length,
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    logger.error('Failed to fetch shows', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch shows', message: (error as Error).message });
  }
});

router.get('/:id', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { id } = req.params;
    
    logger.info(`Fetching event details for ID: ${id}`);
    
    const response = await axios.get<SeatGeekEvent>(`${SEATGEEK_API_BASE}/events/${id}`, {
      params: { 
        client_id: process.env.SEATGEEK_CLIENT_ID,
      },
      timeout: 5000,
    });

    const event = response.data;
    const primaryPerformer = event.performers.find((p) => p.primary) || event.performers[0] || { name: 'Various Artists', image: '' };
    
    const listingCount = event.stats?.listing_count ?? 0;
    const lowestPrice = event.stats?.lowest_price ?? 0;
    const averagePrice = event.stats?.average_price ?? 0;
    const price = lowestPrice || averagePrice;

    const show: Show = {
      id: event.id.toString(),
      title: event.title || event.short_title || 'Untitled Event',
      artist: primaryPerformer.name,
      date: formatDate(event.datetime_local),
      venue: event.venue?.name || 'Unknown Venue',
      city: `${event.venue?.city || 'Unknown'}, ${event.venue?.state || ''}`,
      saleTime: formatTime(event.datetime_local),
      availableSeats: listingCount,
      price: price > 0 ? Math.round(price) : 0,
      sections: ['General Admission'],
      imageUrl: primaryPerformer.image || '',
      eventUrl: event.url || '',
      isAvailable: listingCount > 0 && price > 0,
    };

    res.json({ success: true, show, timestamp: new Date().toISOString() });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Show not found', message: `No event found with ID: ${req.params.id}` });
    }
    logger.error('Failed to fetch show', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch show', message: (error as Error).message });
  }
});

router.post('/:id/reserve', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek CLIENT_ID missing' });
    }

    const { id } = req.params;
    const { quantity = 1 } = req.body;
    
    const response = await axios.get<SeatGeekEvent>(`${SEATGEEK_API_BASE}/events/${id}`, {
      params: { 
        client_id: process.env.SEATGEEK_CLIENT_ID,
      },
      timeout: 5000,
    });

    const event = response.data;
    const listingCount = event.stats?.listing_count ?? 0;
    const lowestPrice = event.stats?.lowest_price ?? 0;
    const averagePrice = event.stats?.average_price ?? 0;
    const price = lowestPrice || averagePrice;

    if (listingCount === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No tickets available', 
        message: `No tickets available for ${event.title}` 
      });
    }

    if (listingCount < quantity) {
      return res.status(400).json({ 
        success: false, 
        error: 'Insufficient tickets', 
        message: `Only ${listingCount} tickets available` 
      });
    }

    if (price === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Price not available', 
        message: `Pricing information not available for ${event.title}` 
      });
    }

    const seatId = `SEAT-${id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const checkoutResponse = await axios.post(
      `${req.protocol}://${req.get('host')}/api/payments/stripe/create-checkout-session`,
      { 
        eventId: id, 
        seatId, 
        quantity, 
        eventTitle: event.title, 
        price: Math.round(price)
      },
      { headers: { 'x-api-key': process.env.TICKET_API_KEY }, timeout: 5000 }
    );

    const checkoutData = checkoutResponse.data as { 
      success: boolean; 
      checkoutUrl?: string; 
      sessionId?: string; 
      message?: string 
    };
    
    if (!checkoutData.success || !checkoutData.checkoutUrl) {
      throw new Error(checkoutData.message || 'Checkout failed');
    }

    const reservationId = `RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    res.json({
      success: true,
      reservationId,
      eventId: id,
      eventTitle: event.title,
      quantity,
      estimatedPrice: Math.round(price * quantity),
      checkoutUrl: checkoutData.checkoutUrl,
      sessionId: checkoutData.sessionId,
      seatId,
      message: 'Redirecting to Stripe',
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