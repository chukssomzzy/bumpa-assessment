import { writeFile } from 'node:fs/promises';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

/** Where the compose healthcheck looks for a recent write; see docker-compose.yml's `worker` service. */
export const HEARTBEAT_PATH = '/tmp/worker-heartbeat';

/**
 * The worker has no HTTP listener, so Docker cannot probe a port for it. This
 * writes a file on an interval; the healthcheck asserts the mtime is recent,
 * which is only true while the event loop is alive enough to run the cron.
 */
@Injectable()
export class WorkerHeartbeatService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // Write once at boot so the healthcheck's `start_period` has something to
    // find immediately, rather than waiting for the first cron tick.
    await this.write();
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async beat(): Promise<void> {
    await this.write();
  }

  private async write(): Promise<void> {
    await writeFile(HEARTBEAT_PATH, new Date().toISOString());
  }
}
