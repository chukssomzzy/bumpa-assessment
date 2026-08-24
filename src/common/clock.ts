/**
 * An injectable time source.
 *
 * Exists so the payout sweeper's staleness window can be tested without waiting
 * in real time. It has no other responsibility.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
