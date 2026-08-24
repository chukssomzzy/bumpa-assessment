import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { HmacScheme, verifyHmac } from '../../common/security/hmac';
import { paymentsConfig } from '../../config/configuration';

/**
 * Paystack's signing convention: hex SHA-512 over the raw body ALONE, in
 * `x-paystack-signature`, keyed by the account's secret key.
 *
 * `timestamp: false` is not an oversight — Paystack sends no timestamp header,
 * so there is nothing to bind and nothing to enforce freshness against. The
 * replay exposure that creates is bounded by what the endpoint does: it only
 * ever re-drives reconciliation for a payout, and `dispatch` reconciles by
 * reference before acting, so a replayed event cannot move money twice.
 */
export const paystackScheme = (config: ConfigType<typeof paymentsConfig>): HmacScheme => ({
  signatureHeader: 'x-paystack-signature',
  secret: config.paystackSecretKey,
  algorithm: 'sha512',
  timestamp: false,
});

/**
 * Verifies that a webhook really came from Paystack.
 *
 * Fails closed when no secret key is configured (the `fake` provider, or a
 * misconfigured deploy): `verifyHmac` returns false rather than signing with
 * `undefined`, so the endpoint rejects everything instead of accepting anything.
 */
@Injectable()
export class PaystackSignatureGuard implements CanActivate {
  constructor(
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();

    if (!verifyHmac(paystackScheme(this.config), request, Math.floor(Date.now() / 1000))) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
