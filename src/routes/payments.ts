// src/routes/payments.ts
import express from 'express';
import Stripe from 'stripe';

const router = express.Router();
const logger = require('../utils/logger').logger;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-08-27.basil' });

router.post('/stripe/create-checkout-session', async (req, res) => {
  try {
    const { shows, userId, totalAmount } = req.body;
    if (!shows?.length || !userId || !totalAmount) {
      return res.status(400).json({ success: false, error: 'Missing fields', message: 'shows, userId, and totalAmount required' });
    }

    const lineItems = shows.map((show: { showId: string; quantity: number; price: number; title: string }) => ({
      price_data: {
        currency: 'usd',
        product_data: { name: `Ticket: ${show.title}`, description: `Show ID: ${show.showId}`, metadata: { showId: show.showId } },
        unit_amount: Math.round(show.price * 100),
      },
      quantity: show.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'myapp://payment-success'}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'myapp://payment-cancelled'}`,
      metadata: { userId, showIds: shows.map((s: any) => s.showId).join(',') },
    });

    logger.payment('Checkout session created', { sessionId: session.id, userId, totalAmount });
    res.json({ success: true, checkoutUrl: session.url, sessionId: session.id, amount: session.amount_total! / 100, currency: 'usd', status: session.status });
  } catch (error) {
    logger.error('Checkout session creation failed', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Checkout failed', message: (error as Error).message });
  }
});

router.get('/stripe/session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    logger.payment('Session retrieved', { sessionId: session.id, status: session.status });
    res.json({ success: true, sessionId: session.id, status: session.status, amount: session.amount_total! / 100, currency: session.currency, paymentStatus: session.payment_status, metadata: session.metadata });
  } catch (error) {
    logger.error('Failed to retrieve session', { error: (error as Error).message });
    res.status(500).json({ success: false, error: 'Session retrieval failed', message: (error as Error).message });
  }
});

router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.error('Webhook secret not configured');
    return res.status(500).json({ success: false, error: 'Webhook secret missing' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      logger.payment('Payment completed', { sessionId: session.id, userId: session.metadata?.userId, showIds: session.metadata?.showIds });
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      logger.payment('Payment expired', { sessionId: session.id, userId: session.metadata?.userId });
    }
    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook error', { error: (error as Error).message });
    res.status(400).json({ success: false, error: 'Webhook error', message: (error as Error).message });
  }
});

export default router;