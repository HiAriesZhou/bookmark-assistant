// 🎫 Paddle Billing Types

export type PaddleSubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';

export type PaddleWebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.activated'
  | 'subscription.trialing'
  | 'subscription.past_due'
  | 'subscription.paused'
  | 'subscription.canceled'
  | 'subscription.resumed'
  | 'transaction.completed'
  | 'transaction.updated'
  | 'transaction.created';

export interface PaddleCustomData {
  userId: string;
  userEmail?: string;
  source?: string;
  pricing?: 'monthly' | 'yearly';
}

export interface PaddleWebhookEvent {
  event_id: string;
  event_type: PaddleWebhookEventType;
  occurred_at: string;
  notification_id: string;
  data: {
    id: string;
    status?: PaddleSubscriptionStatus;
    customer_id: string;
    subscription_id?: string;
    custom_data?: PaddleCustomData;
    next_billed_at?: string;
    canceled_at?: string;
    paused_at?: string;
    started_at?: string;
    first_billed_at?: string;
    current_billing_period?: {
      starts_at: string;
      ends_at: string;
    };
    items?: Array<{
      price_id: string;
      quantity: number;
    }>;
  };
}
