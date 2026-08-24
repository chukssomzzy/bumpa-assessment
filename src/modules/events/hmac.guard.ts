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
import { webhookConfig } from '../../config/configuration';

/**
 * The storefront's signing convention: `{timestamp}.{rawBody}`, hex SHA-512.
 *
 * The timestamp is part of the signed payload, not just a header. Signing the
 * body alone would leave the freshness window unauthenticated: a captured
 * request could be replayed indefinitely by rewriting x-timestamp, and the
 * original signature would still verify.
 */
export const storefrontScheme = (config: ConfigType<typeof webhookConfig>): HmacScheme => ({
  signatureHeader: 'x-signature',
  secret: config.secret,
  algorithm: 'sha512',
  timestamp: {
    header: 'x-timestamp',
    // `toleranceSeconds` carries a schema default, which — like `appConfig.port`
    // elsewhere — types as optional even though it is always populated at boot.
    toleranceSeconds: config.toleranceSeconds ?? 300,
  },
});

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
  constructor(
    @Inject(webhookConfig.KEY)
    private readonly config: ConfigType<typeof webhookConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (!verifyHmac(storefrontScheme(this.config), request, nowSeconds)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
