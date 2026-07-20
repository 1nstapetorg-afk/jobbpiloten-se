// Dedicated Stripe webhook route — must NOT go through the catch-all
// because we need the raw request body for signature verification.
// This route is public (bypasses Clerk middleware via /api/webhooks/(.*) in publicRoutes).

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { MongoClient } from 'mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-06-30.basil' });

// Reuse Mongo singleton
let clientPromise;
if (!global._mongoClientPromise) {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten');
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDb() {
  const c = await clientPromise;
  return c.db(process.env.DB_NAME);
}

function tierFromPriceId(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_BASIC_MONTHLY]: { tier: 'Basic', interval: 'month' },
    [process.env.STRIPE_PRICE_BASIC_YEARLY]: { tier: 'Basic', interval: 'year' },
    [process.env.STRIPE_PRICE_PRO_MONTHLY]: { tier: 'Professional', interval: 'month' },
    [process.env.STRIPE_PRICE_PRO_YEARLY]: { tier: 'Professional', interval: 'year' },
    [process.env.STRIPE_PRICE_ELITE_MONTHLY]: { tier: 'Elite', interval: 'month' },
    [process.env.STRIPE_PRICE_ELITE_YEARLY]: { tier: 'Elite', interval: 'year' },
  };
  return map[priceId] || { tier: 'Unknown', interval: null };
}

export async function POST(req) {
  const body = await req.text();
  const h = await headers();
  const signature = h.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log('[stripe webhook]', event.type);

  try {
    const db = await getDb();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const clerkId = session.client_reference_id || session.metadata?.clerkId;
        const subscriptionId = session.subscription;

        if (!clerkId) {
          console.warn('[stripe webhook] no clerkId in session');
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
        const priceId = subscription.items.data[0]?.price?.id;
        const { tier, interval } = tierFromPriceId(priceId);

        await db.collection('profiles').updateOne(
          { clerkId },
          {
            $set: {
              stripeCustomerId: session.customer,
              stripeSubscriptionId: subscription.id,
              subscriptionStatus: subscription.status,
              stripePriceId: priceId,
              tier,
              billingInterval: interval,
              currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
              cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true }
        );
        console.log('[stripe webhook] subscription activated for', clerkId, 'tier=', tier);
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const { tier, interval } = tierFromPriceId(priceId);

        await db.collection('profiles').updateOne(
          { stripeSubscriptionId: subscription.id },
          {
            $set: {
              subscriptionStatus: subscription.status,
              stripePriceId: priceId,
              tier: subscription.status === 'canceled' ? 'Basic' : tier,
              billingInterval: interval,
              currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
              cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
              updatedAt: new Date(),
            },
          }
        );
        console.log('[stripe webhook]', event.type, 'sub=', subscription.id, 'status=', subscription.status);
        break;
      }

      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    console.error('[stripe webhook] handler error:', err);
    return new NextResponse('Webhook handler error', { status: 500 });
  }

  return NextResponse.json({ received: true });
}
