// src/routes/shows.ts
import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger'; // Import logger explicitly

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
  stats?: { listing_count?: number; lowest_price?: number; average_price?: number };
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

const fetchAllEvents = async (params: { location?: string; type?: string }): Promise<SeatGeekEvent[]> => {
  const allEvents: SeatGeekEvent[] = [];
  let page = 1;
  const perPage = 100;
  const maxPages = 50;

  while (page <= maxPages) {
    try {
      const response = await axios.get<{ events: SeatGeekEvent[]; meta: { total: number } }>(
        `${SEATGEEK_API_BASE}/events`,
        {
          params: {
            client_id: process.env.SEATGEEK_CLIENT_ID,
            client_secret: process.env.SEATGEEK_CLIENT_SECRET,
            'venue.city': params.location || 'New York',
            type: params.type || 'concert',
            page,
            per_page: perPage,
            sort: 'datetime_local.asc',
            'datetime_local.gte': new Date().toISOString(),
          },
          timeout: 10000,
        }
      );

      const events = response.data.events;
      allEvents.push(...events);

      if (events.length < perPage) break;
      page++;
      await new Promise((resolve) => setTimeout(resolve, 100)); // Rate limiting
    } catch (error) {
      logger.error('Error fetching SeatGeek events', { page, error: (error as Error).message });
      break;
    }
  }

  return allEvents;
};

router.get('/', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID || !process.env.SEATGEEK_CLIENT_SECRET) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek credentials missing' });
    }

    const { location = 'New York', type = 'concert', fetch_all = 'true' } = req.query;
    let events: SeatGeekEvent[] = [];

    if (fetch_all === 'true') {
      events = await fetchAllEvents({ location: location as string, type: type as string });
    } else {
      const response = await axios.get<{ events: SeatGeekEvent[] }>(`${SEATGEEK_API_BASE}/events`, {
        params: {
          client_id: process.env.SEATGEEK_CLIENT_ID,
          client_secret: process.env.SEATGEEK_CLIENT_SECRET,
          'venue.city': location,
          type: type,
          per_page: 25,
          sort: 'datetime_local.asc',
          'datetime_local.gte': new Date().toISOString(),
        },
        timeout: 10000,
      });
      events = response.data.events;
    }

    const shows = events.map((event) => {
      const primaryPerformer = event.performers.find((p) => p.primary) || event.performers[0] || { name: 'Various Artists' };
      const price = (event.stats?.lowest_price || event.stats?.average_price || 0) as number;
      return {
        id: event.id.toString(),
        title: event.title || event.short_title || 'Untitled Event',
        artist: primaryPerformer.name,
        date: formatDate(event.datetime_local),
        venue: event.venue.name || 'Unknown Venue',
        city: `${event.venue.city}, ${event.venue.state}`,
        saleTime: formatTime(event.datetime_local),
        availableSeats: event.stats?.listing_count || 0,
        price,
        sections: ['General Admission'],
        imageUrl: primaryPerformer.image || '',
        eventUrl: event.url || '',
        isAvailable: (event.stats?.listing_count || 0) > 0 && price > 0,
      };
    });

    res.json({ success: true, shows, total: shows.length, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Failed to fetch shows', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch shows', message: (error as Error).message });
  }
});

router.get('/:id', verifyApiKey, async (req, res) => {
  try {
    if (!process.env.SEATGEEK_CLIENT_ID || !process.env.SEATGEEK_CLIENT_SECRET) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek credentials missing' });
    }

    const { id } = req.params;
    const response = await axios.get<SeatGeekEvent>(`${SEATGEEK_API_BASE}/events/${id}`, {
      params: { client_id: process.env.SEATGEEK_CLIENT_ID, client_secret: process.env.SEATGEEK_CLIENT_SECRET },
      timeout: 5000,
    });

    const event = response.data;
    const primaryPerformer = event.performers.find((p) => p.primary) || event.performers[0] || { name: 'Various Artists' };
    const price = (event.stats?.lowest_price || event.stats?.average_price || 0) as number;

    const show: Show = {
      id: event.id.toString(),
      title: event.title || event.short_title || 'Untitled Event',
      artist: primaryPerformer.name,
      date: formatDate(event.datetime_local),
      venue: event.venue.name || 'Unknown Venue',
      city: `${event.venue.city}, ${event.venue.state}`,
      saleTime: formatTime(event.datetime_local),
      availableSeats: event.stats?.listing_count || 0,
      price,
      sections: ['General Admission'],
      imageUrl: primaryPerformer.image || '',
      eventUrl: event.url || '',
      isAvailable: (event.stats?.listing_count || 0) > 0 && price > 0,
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
    if (!process.env.SEATGEEK_CLIENT_ID || !process.env.SEATGEEK_CLIENT_SECRET) {
      return res.status(500).json({ success: false, error: 'Configuration Error', message: 'SeatGeek credentials missing' });
    }

    const { id } = req.params;
    const { quantity = 1 } = req.body;
    const response = await axios.get<SeatGeekEvent>(`${SEATGEEK_API_BASE}/events/${id}`, {
      params: { client_id: process.env.SEATGEEK_CLIENT_ID, client_secret: process.env.SEATGEEK_CLIENT_SECRET },
      timeout: 5000,
    });

    const event = response.data;
    const listingCount = event.stats?.listing_count || 0;
    if (listingCount === 0) return res.status(400).json({ success: false, error: 'No tickets available', message: `No tickets for ${event.title}` });
    if (listingCount < quantity) return res.status(400).json({ success: false, error: 'Insufficient tickets', message: `Only ${listingCount} available` });

    const price = (event.stats?.lowest_price || event.stats?.average_price || 0) as number;
    if (price <= 0) return res.status(400).json({ success: false, error: 'Invalid price', message: `No valid price for ${event.title}` });

    const seatId = `SEAT-${id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const checkoutResponse = await axios.post(
      `${req.protocol}://${req.get('host')}/api/payments/stripe/create-checkout-session`,
      { eventId: id, seatId, quantity, eventTitle: event.title, price },
      { headers: { 'x-api-key': process.env.TICKET_API_KEY }, timeout: 5000 }
    );

    const checkoutData = checkoutResponse.data as { success: boolean; checkoutUrl?: string; sessionId?: string; message?: string };
    if (!checkoutData.success || !checkoutData.checkoutUrl) throw new Error(checkoutData.message || 'Checkout failed');

    const reservationId = `RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    res.json({
      success: true,
      reservationId,
      eventId: id,
      eventTitle: event.title,
      quantity,
      estimatedPrice: price * quantity,
      checkoutUrl: checkoutData.checkoutUrl,
      sessionId: checkoutData.sessionId,
      seatId,
      message: 'Redirecting to Stripe',
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Event not found', message: `No event with ID: ${req.params.id}` });
    }
    logger.error('Reservation failed', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Reservation failed', message: (error as Error).message });
  }
});

export default router;