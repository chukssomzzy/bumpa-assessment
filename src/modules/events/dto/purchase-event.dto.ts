import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** The only event type consumed today. */
export const purchaseEventSchema = z.object({
  type: z.literal('purchase.completed'),
  eventId: z.string().min(1),
  userId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});

export type PurchaseEvent = z.infer<typeof purchaseEventSchema>;

/**
 * OpenAPI documentation for the ingest body.
 *
 * The zod schema above remains the single runtime source of truth — this class
 * is never constructed and never validates anything. It exists because OpenAPI
 * metadata must hang off a class, and a zod schema has no runtime shape to
 * decorate.
 *
 * The two can therefore drift, so `purchase-event.dto.spec.ts` parses this
 * class's documented example through `purchaseEventSchema` and fails if the
 * documentation describes a body the service would reject.
 */
export class PurchaseEventBody implements PurchaseEvent {
  @ApiProperty({
    description: 'The only event type accepted today.',
    enum: ['purchase.completed'],
    example: 'purchase.completed',
  })
  type!: 'purchase.completed';

  @ApiProperty({
    description:
      'Producer-assigned unique id. Redelivering the same id is a no-op, so retries are safe.',
    example: 'b6b1d4d4-6a6f-4a1e-9f0e-5f2f1a8a7c11',
  })
  eventId!: string;

  @ApiProperty({
    description: 'The customer who made the purchase.',
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  userId!: string;

  @ApiProperty({
    description: 'When the purchase happened, ISO 8601.',
    format: 'date-time',
    example: '2026-08-24T10:15:30.000Z',
  })
  occurredAt!: string;
}

/** The documented example, extracted so a test can prove the schema accepts it. */
export const PURCHASE_EVENT_EXAMPLE: PurchaseEvent = {
  type: 'purchase.completed',
  eventId: 'b6b1d4d4-6a6f-4a1e-9f0e-5f2f1a8a7c11',
  userId: '11111111-1111-4111-8111-111111111111',
  occurredAt: '2026-08-24T10:15:30.000Z',
};
