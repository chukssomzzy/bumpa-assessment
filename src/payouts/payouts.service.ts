import { Injectable } from '@nestjs/common';

@Injectable()
export class PayoutsService {
  /**
   * Dispatches one pending payout.
   *
   * Resolves a transfer recipient, transfers, and moves the payout to a terminal
   * state. On an unknown outcome it reconciles by reference before considering a
   * retry, so an already-completed transfer is never repeated. Becomes terminally
   * failed once the configured attempt limit is reached.
   */
  dispatch(_payoutId: string): Promise<void> {
    throw new Error('not implemented');
  }

  /** Re-enqueues payouts left pending beyond the staleness window. */
  sweepStalePayouts(): Promise<number> {
    throw new Error('not implemented');
  }
}
