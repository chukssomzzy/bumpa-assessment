import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { webhookConfig } from '../../config/configuration';

const HEX_PATTERN = /^[0-9a-f]+$/i;

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

    const signature = request.header('x-signature');
    const timestampHeader = request.header('x-timestamp');
    if (!signature || !HEX_PATTERN.test(signature) || !timestampHeader) {
      throw new UnauthorizedException();
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      throw new UnauthorizedException();
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    // `toleranceSeconds` carries a schema default, which — like `appConfig.port`
    // elsewhere — types as optional even though it is always populated at boot.
    if (Math.abs(nowSeconds - timestamp) > (this.config.toleranceSeconds ?? 300)) {
      throw new UnauthorizedException();
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException();
    }

    const expected = createHmac('sha512', this.config.secret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(signature, 'hex');
    // timingSafeEqual throws on unequal lengths rather than returning false, so
    // the length check must come first and must not leak timing either way.
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
