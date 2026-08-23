import { clearHandoff } from './containers';

export default async function globalTeardown(): Promise<void> {
  await Promise.all([globalThis.__PG__?.stop(), globalThis.__REDIS__?.stop()]);
  clearHandoff();
}
