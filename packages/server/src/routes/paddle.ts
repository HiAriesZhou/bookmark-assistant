// 🎫 Paddle Webhook Handler

import { Router, Request, Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import crypto from 'crypto';
import { Paddle, type Environment } from '@paddle/paddle-node-sdk';
import { config } from '../config';
import { prisma } from '../services/userPrisma';
import { auditLog } from '../utils';
import type { PaddleWebhookEvent, PaddleCustomData } from '../types/paddle';
import { validateSession } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { isRecurringPurchaseType, resolveRecurringPurchaseType } from '../services/paddle-plans';

const router: ExpressRouter = Router();

// Initialize Paddle client
// Paddle SDK expects specific Environment type
const paddleEnv: Environment = (
  config.paddle.environment === 'production' ? 'production' : 'sandbox'
) as Environment;

const paddle = config.commerceEnabled
  ? new Paddle(config.paddle.apiKey, {
      environment: paddleEnv,
    })
  : null;

function isPaddleManagedUser(user: {
  plan?: string | null;
  paddleCustomerId?: string | null;
  subscriptionSource?: string | null;
}): boolean {
  return (
    user.plan === 'pro' &&
    !!user.paddleCustomerId &&
    (user.subscriptionSource === null ||
      user.subscriptionSource === undefined ||
      user.subscriptionSource === 'paddle')
  );
}

function getPaddleOrRespond(res: Response): Paddle | null {
  if (paddle) {
    return paddle;
  }

  res.status(503).json({
    success: false,
    error: 'Commerce disabled',
    message: 'Paddle billing is not configured for this deployment.',
  });
  return null;
}

async function createCheckout(req: Request, res: Response) {
  try {
    const paddleClient = getPaddleOrRespond(res);
    if (!paddleClient) return;

    const { pricing, userId, email } = req.body;

    if (!isRecurringPurchaseType(pricing) || !userId) {
      return res.status(400).json({ error: 'Missing required fields: pricing, userId' });
    }

    console.log('Creating Paddle checkout', { pricing, source: 'extension' });

    const priceId =
      pricing === 'monthly' ? config.paddle.priceIds.proMonthly : config.paddle.priceIds.proYearly;

    if (!priceId) {
      return res.status(503).json({
        error: 'Price not configured',
        message: `No Paddle price ID configured for ${pricing}.`,
      });
    }

    // Create a transaction (checkout session) via Paddle API
    const transaction = await paddleClient.transactions.create({
      items: [
        {
          priceId,
          quantity: 1,
        },
      ],
      customData: {
        userId,
        source: 'extension',
        pricing,
      },
      ...(email && {
        customerEmail: email,
      }),
    });

    // Get the checkout URL from the transaction (hosted checkout page)
    const checkoutUrl = (transaction as any).url || transaction.checkout?.url;

    if (!checkoutUrl) {
      throw new Error('Paddle did not return a checkout URL');
    }

    console.log('Paddle checkout created');

    // Directly return Paddle hosted checkout URL to the extension
    return res.json({ checkoutUrl });
  } catch (error) {
    console.error('❌ Failed to create checkout URL:', error);
    auditLog('PADDLE_CHECKOUT', 'FAILED', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Failed to create checkout URL',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Existing store clients did not send a session header. Keep their checkout path
// during the client rollout; billing activation still requires a verified webhook.
router.post('/checkout-url', createCheckout);
router.post('/checkout-url/v2', validateSession, (req: AuthenticatedRequest, res: Response) => {
  if (req.body?.userId !== req.user?.userId)
    return res.status(403).json({ error: 'Account mismatch' });
  return createCheckout(req, res);
});

/**
 * Paddle Webhook Endpoint
 * Handles all subscription lifecycle events from Paddle
 */
router.post('/webhooks/paddle', async (req: Request, res: Response) => {
  try {
    if (!config.commerceEnabled) {
      return res.status(503).json({
        success: false,
        error: 'Commerce disabled',
        message: 'Paddle webhooks are disabled for this deployment.',
      });
    }

    const signature = req.headers['paddle-signature'] as string;
    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const event = req.body as PaddleWebhookEvent;
    if (!event || !event.data) {
      return res.status(400).json({ error: 'Invalid event structure' });
    }

    console.log(`📥 Webhook: ${event.event_type}`, event.event_id);

    // Handle subscription lifecycle events for recurring subscriptions.
    if (
      [
        'subscription.created',
        'subscription.updated',
        'subscription.activated',
        'subscription.canceled',
        'subscription.past_due',
        'subscription.paused',
      ].includes(event.event_type)
    ) {
      const data = event.data;
      const customData = data.custom_data as PaddleCustomData | undefined;
      const purchaseType = resolveRecurringPurchaseType(
        {
          itemPriceIds: data.items?.map((item) => item.price_id),
          checkoutPricing: customData?.pricing,
        },
        {
          monthly: config.paddle.priceIds.proMonthly,
          yearly: config.paddle.priceIds.proYearly,
        }
      );

      // Determine plan status based on subscription status
      // Paddle statuses: 'active', 'canceled', 'past_due', 'paused', 'trialing'
      const isActive = data.status ? ['active', 'trialing'].includes(data.status) : false;
      const newPlan = isActive ? 'pro' : 'free';

      console.log(`🔄 Processing subscription update: ${data.status} -> ${newPlan}`);

      // DEBUG: Log detailed context to debug matching issues
      console.log('🔍 Webhook Context:', {
        customerId: data.customer_id,
        customData,
        hasInternalUserId: !!customData?.userId,
        hasEmail: !!customData?.userEmail,
      });

      const email = customData?.userEmail;

      // Internal user id from customData (always CUID in new design)
      const internalUserId = customData?.userId;

      if (internalUserId) {
        try {
          // Ensure paddleCustomerId uniqueness: if another user holds this id, clear it there first
          const existingWithCustomer = await prisma.user.findFirst({
            where: {
              paddleCustomerId: data.customer_id,
              NOT: { id: internalUserId },
            },
            select: { id: true },
          });

          if (existingWithCustomer) {
            await prisma.user.update({
              where: { id: existingWithCustomer.id },
              data: { paddleCustomerId: null },
            });
          }

          await prisma.user.update({
            where: { id: internalUserId },
            data: {
              plan: newPlan,
              subscriptionSource: 'paddle',
              expiresAt: null,
              paddleCustomerId: data.customer_id,
              paddleSubscriptionId: data.subscription_id || data.id,
              purchaseType,
            },
          });
          console.log(`✅ Updated user ${internalUserId} to ${newPlan} via webhook (by userId)`);
        } catch (e) {
          console.warn(`⚠️ Failed to update user ${internalUserId} from webhook:`, e);
        }
      } else {
        // Fallback: Try to find user by Paddle Customer ID
        // This is crucial for updates/cancellations where custom_data might be missing
        console.log(`🔍 Attempting fallback lookup by Paddle Customer ID: ${data.customer_id}`);

        const userByPaddleId = await prisma.user.findFirst({
          where: { paddleCustomerId: data.customer_id },
        });

        if (userByPaddleId) {
          console.log(`✅ Found user via Customer ID: ${userByPaddleId.id}`);
          try {
            await prisma.user.update({
              where: { id: userByPaddleId.id },
              data: {
                plan: newPlan,
                subscriptionSource: 'paddle',
                expiresAt: null,
                paddleSubscriptionId: data.subscription_id || data.id,
                purchaseType: purchaseType || userByPaddleId.purchaseType,
              },
            });
            console.log(
              `✅ Updated user ${userByPaddleId.id} to ${newPlan} via webhook (by paddleCustomerId)`
            );
          } catch (e) {
            console.warn(`⚠️ Failed to update user ${userByPaddleId.id} from webhook:`, e);
          }
        } else if (email) {
          // 3. Email Check: Upsert
          // "If no passthrough, prisma.user.upsert"
          const licenseKey = crypto.randomUUID();

          await prisma.user.upsert({
            where: { email },
            create: {
              email,
              plan: newPlan,
              subscriptionSource: 'paddle',
              expiresAt: null,
              paddleCustomerId: data.customer_id,
              paddleSubscriptionId: data.subscription_id || data.id,
              purchaseType: purchaseType || 'monthly',
              licenseKey,
              // notionUserId is NULL initially
            },
            update: {
              plan: newPlan,
              subscriptionSource: 'paddle',
              expiresAt: null,
              paddleCustomerId: data.customer_id,
              paddleSubscriptionId: data.subscription_id || data.id,
              purchaseType: purchaseType || 'monthly',
            },
          });
          console.log(`✅ Upserted user ${email} to ${newPlan} via webhook (by email)`);
        } else {
          console.warn(
            '⚠️ Webhook received but no email, userId, or known customerId found to reconcile.',
            {
              customerId: data.customer_id,
              customData,
            }
          );
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Paddle webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create Billing Portal Session
 * Generates a self-service portal link for the user to manage their subscription
 */
router.post(
  '/portal-session',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Get user's subscription info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          paddleCustomerId: true,
          paddleSubscriptionId: true,
          purchaseType: true,
          email: true,
          plan: true,
          subscriptionSource: true,
        },
      });

      if (!user || !isPaddleManagedUser(user)) {
        return res.status(404).json({
          success: false,
          error: 'No active subscription found',
          message: 'You need an active Pro subscription to access the management portal.',
        });
      }

      // Recurring subscriptions require a subscription ID.
      if (!user.paddleSubscriptionId) {
        return res.status(404).json({
          success: false,
          error: 'Subscription ID not found',
          message: 'Your subscription data is incomplete. Please contact support.',
        });
      }

      const paddleClient = getPaddleOrRespond(res);
      if (!paddleClient) return;

      // Create portal session with correct subscription ID
      try {
        const portalSession = await paddleClient.customerPortalSessions.create(
          user.paddleCustomerId!,
          [user.paddleSubscriptionId]
        );

        if (!portalSession?.urls?.general) {
          throw new Error('No portal URL returned from Paddle');
        }

        auditLog('portal_session_created', userId, {
          customerId: user.paddleCustomerId,
          subscriptionId: user.paddleSubscriptionId,
        });

        res.json({
          success: true,
          url: portalSession.urls.general,
        });
      } catch (paddleError: any) {
        console.error('Paddle Portal Error:', paddleError);
        return res.status(500).json({
          success: false,
          error: 'Portal unavailable',
          message: 'Could not generate portal link. Please contact support.',
        });
      }
    } catch (error) {
      console.error('Portal Session Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to generate management link',
      });
    }
  }
);

/**
 * Cancel Subscription
 * Cancel a recurring subscription (effective at end of billing period)
 */
router.post(
  '/cancel-subscription',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Get user's subscription info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          paddleSubscriptionId: true,
          purchaseType: true,
          plan: true,
          subscriptionSource: true,
          paddleCustomerId: true,
        },
      });

      if (!user || !isPaddleManagedUser(user)) {
        return res.status(404).json({
          success: false,
          error: 'No active subscription found',
        });
      }

      if (!user.paddleSubscriptionId) {
        return res.status(404).json({
          success: false,
          error: 'Subscription ID not found',
        });
      }

      const paddleClient = getPaddleOrRespond(res);
      if (!paddleClient) return;

      try {
        // Cancel subscription effective at end of billing period
        await paddleClient.subscriptions.cancel(user.paddleSubscriptionId, {
          effectiveFrom: 'next_billing_period',
        });

        auditLog('subscription_cancelled', userId, {
          subscriptionId: user.paddleSubscriptionId,
          effectiveFrom: 'next_billing_period',
        });

        res.json({
          success: true,
          message: 'Subscription will be cancelled at the end of the current billing period',
        });
      } catch (paddleError: any) {
        console.error('Paddle Cancel Error:', paddleError);
        return res.status(500).json({
          success: false,
          error: 'Failed to cancel subscription',
        });
      }
    } catch (error) {
      console.error('Cancel Subscription Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal Server Error',
      });
    }
  }
);

/**
 * Get Subscription Info
 * Retrieve subscription details including next billing date
 */
router.get(
  '/subscription-info',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          paddleSubscriptionId: true,
          purchaseType: true,
          plan: true,
          subscriptionSource: true,
          paddleCustomerId: true,
        },
      });

      if (!user || !isPaddleManagedUser(user)) {
        return res.status(404).json({
          success: false,
          error: 'No active subscription found',
        });
      }

      if (!user.paddleSubscriptionId) {
        return res.status(404).json({
          success: false,
          error: 'Subscription ID not found',
        });
      }

      const paddleClient = getPaddleOrRespond(res);
      if (!paddleClient) return;

      try {
        const subscription = await paddleClient.subscriptions.get(user.paddleSubscriptionId);

        const nextBillingDate = subscription.nextBilledAt
          ? new Date(subscription.nextBilledAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : null;

        res.json({
          success: true,
          status: subscription.status,
          nextBillingDate,
        });
      } catch (paddleError: any) {
        console.error('Paddle Get Subscription Error:', paddleError);
        return res.status(500).json({
          success: false,
          error: 'Failed to get subscription info',
        });
      }
    } catch (error) {
      console.error('Get Subscription Info Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal Server Error',
      });
    }
  }
);

export default router;
