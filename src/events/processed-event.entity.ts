import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The authoritative dedupe record. Written inside the evaluation transaction —
 * never at the HTTP boundary, so that a crash before enqueue stays recoverable
 * by the producer's retry.
 */
@Entity('processed_events')
export class ProcessedEventEntity {
  @PrimaryColumn({ name: 'event_id' })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;
}
