import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { EVALUATE_QUEUE } from '../../common/queues';
import { HealthRepository } from './repositories/health.repository';

interface DependencyStatus {
  status: 'ok' | 'error';
  error?: string;
}

interface ReadinessBody {
  status: 'ok' | 'error';
  dependencies: { postgres: DependencyStatus; redis: DependencyStatus };
}

const toStatus = (result: PromiseSettledResult<void>): DependencyStatus =>
  result.status === 'fulfilled'
    ? { status: 'ok' }
    : {
        status: 'error',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthRepository,
    @InjectQueue(EVALUATE_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Liveness: no dependency checks. Docker probes this frequently, so it must
   * stay cheap regardless of Postgres or Redis's state.
   */
  @Get()
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: 200 only when both dependencies answer, 503 with a per-dependency breakdown otherwise. */
  @Get('ready')
  async readiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessBody> {
    const [postgres, redis] = await Promise.allSettled([this.checkPostgres(), this.checkRedis()]);
    const dependencies = { postgres: toStatus(postgres), redis: toStatus(redis) };
    const healthy = dependencies.postgres.status === 'ok' && dependencies.redis.status === 'ok';

    response.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'error', dependencies };
  }

  private async checkPostgres(): Promise<void> {
    await this.health.ping();
  }

  private async checkRedis(): Promise<void> {
    const client = await this.queue.client;
    // `IRedisClient` abstracts ioredis/node-redis/Bun and does not guarantee
    // `ping()`; `info()` is declared on all adapters and is an equally valid
    // round trip to prove the connection answers.
    await client.info();
  }
}
