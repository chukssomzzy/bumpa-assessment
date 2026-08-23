import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Verifies that a request was signed by the storefront.
 *
 * This is the money boundary: an unverified ingest endpoint lets anyone fabricate
 * purchases and draw cashback until the provider balance is empty. Rejects a bad
 * signature, and a timestamp outside the freshness window so a captured payload
 * cannot be replayed later.
 */
@Injectable()
export class HmacGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new Error('not implemented');
  }
}
