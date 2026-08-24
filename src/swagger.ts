import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const API_DESCRIPTION = `
Achievements, badges and automated cashback.

Customers unlock **achievements** as their purchase count crosses tier thresholds. Crossing enough
achievements earns a **badge**, and every badge above the entry tier pays **cashback** automatically
via a bank transfer.

### Signing

Both write endpoints are signed, and they do **not** share a convention:

| Endpoint | Header | Signed payload |
| --- | --- | --- |
| \`POST /events\` | \`x-signature\` + \`x-timestamp\` | \`{timestamp}.{rawBody}\`, hex SHA-512 |
| \`POST /webhooks/paystack\` | \`x-paystack-signature\` | the raw body alone, hex SHA-512 |

The storefront binds the timestamp into the signed payload deliberately: signing the body alone
would leave the freshness window unauthenticated, so a captured request could be replayed forever by
rewriting \`x-timestamp\`. Paystack sends no timestamp header, so there is nothing to bind.

Signatures are computed over the **exact bytes received**, never over a re-serialised object.

### Money-path guarantees

- One payout per badge, enforced by a unique constraint rather than application logic.
- A badge cannot exist without a payout row — both are written in one transaction.
- An ambiguous provider outcome is never terminal. Money may have moved, so it is reconciled by
  reference before any retry.

### Errors

Errors are shaped \`{ "success": false, "statusCode": 4xx, "message": "..." }\`, with an optional
\`errors\` array carrying field-level detail. **Success responses are not enveloped** — the
achievements payload is returned raw, because that shape is the API contract.
`;

/**
 * Mounts the OpenAPI document at `/docs` (UI) and `/docs-json` (raw).
 *
 * Called from `main.ts` only. The worker role has no HTTP server, and the BDD
 * tier opts in explicitly, so nothing pays for document generation by default.
 *
 * Two deliberate departures from the house reference:
 *
 * 1. **No global path prefix.** The reference mounts everything under `api/v1`.
 *    Here `GET /users/:user/achievements` and `POST /events` are the API
 *    contract at those exact paths, so a prefix would break them.
 * 2. **No `@nestjs/swagger` CLI plugin.** The plugin infers schemas at build
 *    time and does NOT run under ts-jest, so a document built from it would be
 *    empty in tests and the OpenAPI spec would assert against nothing. Explicit
 *    `@ApiProperty` decorators are runtime metadata and behave identically
 *    under `nest build` and Jest. (`classValidatorShim` would be dead weight
 *    regardless: validation here is zod, not class-validator.)
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Bumpa Achievements API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0')
    .addServer('http://localhost:3000', 'Local development')
    .addTag('events', 'Signed purchase-event ingest')
    .addTag('achievements', 'Customer achievement and badge progress')
    .addTag('webhooks', 'Inbound payment-provider callbacks')
    .addTag('health', 'Liveness and readiness probes')
    .addGlobalParameters({
      description:
        'Optional correlation id — echoed back as X-Request-Id and carried into queue jobs; generated when absent',
      in: 'header',
      name: 'x-request-id',
      required: false,
      schema: { format: 'uuid', type: 'string' },
    })
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Bumpa Achievements API',
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: {
      displayRequestDuration: true,
      operationsSorter: 'alpha',
      persistAuthorization: true,
      tagsSorter: 'alpha',
    },
  });
}
