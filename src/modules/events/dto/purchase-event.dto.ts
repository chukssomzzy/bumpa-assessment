import { z } from 'zod';

/** The only event type consumed today. */
export const purchaseEventSchema = z.object({
  type: z.literal('purchase.completed'),
  eventId: z.string().min(1),
  userId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});

export type PurchaseEvent = z.infer<typeof purchaseEventSchema>;
