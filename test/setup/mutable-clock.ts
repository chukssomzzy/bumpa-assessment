import { Clock } from '../../src/common/clock';

/** Lets a test advance time so the sweeper's staleness window is reachable. */
export class MutableClock extends Clock {
  constructor(private current = new Date('2026-01-01T00:00:00.000Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
