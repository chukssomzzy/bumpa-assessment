import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Where globalSetup publishes connection details for the test workers. */
export const HANDOFF = join(__dirname, '.containers.json');

export interface ContainerHandoff {
  databaseUrl: string;
  redisUrl: string;
}

export const writeHandoff = (h: ContainerHandoff): void =>
  writeFileSync(HANDOFF, JSON.stringify(h));

export const readHandoff = (): ContainerHandoff =>
  JSON.parse(readFileSync(HANDOFF, 'utf8')) as ContainerHandoff;

export const clearHandoff = (): void => {
  if (existsSync(HANDOFF)) unlinkSync(HANDOFF);
};
