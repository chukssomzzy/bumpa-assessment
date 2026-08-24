import request from 'supertest';
import { createBddWorld, type BddWorld } from '../support/application/bdd-world';

/**
 * The published contract: whatever this application serves at `/docs-json` is
 * what an integrator builds against. These scenarios read that document over
 * HTTP exactly as an integrator would — never the decorators that produced it —
 * so a route that exists but is undocumented, or documented under the wrong
 * name, is a failure here rather than a surprise at the other end of the wire.
 *
 * The world is booted with `{ swagger: true }`; the other suites leave the flag
 * off and never pay for document generation.
 */

const DOCS_JSON_PATH = '/docs-json';
const DOCS_UI_PATH = '/docs';

/** The verbs a path item may carry. Anything else there is not an operation. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];

/** Every route this application publishes, and the verb each one answers on. */
const DOCUMENTED_ROUTES: Record<string, string[]> = {
  '/events': ['post'],
  '/users/{user}/achievements': ['get'],
  '/webhooks/paystack': ['post'],
  '/health': ['get'],
  '/health/ready': ['get'],
};

/**
 * The graded response contract for the achievements view (see CONTEXT.md): five
 * snake_case keys, returned raw with no envelope. The document has to say so.
 */
const ACHIEVEMENTS_RESPONSE_PROPERTIES = [
  'unlocked_achievements',
  'next_available_achievements',
  'current_badge',
  'next_badge',
  'remaining_to_unlock_next_badge',
];

interface OpenApiSchema {
  $ref?: string;
  properties?: Record<string, unknown>;
}

interface OpenApiParameter {
  name: string;
  in: string;
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  responses?: Record<string, { content?: Record<string, { schema?: OpenApiSchema }> }>;
}

interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

/** Reads the served document, as an integrator would fetch it. */
async function readOpenApiDocument(world: BddWorld): Promise<OpenApiDocument> {
  const response = await request(world.app.getHttpServer()).get(DOCS_JSON_PATH);
  expect(response.status).toBe(200);
  return response.body as OpenApiDocument;
}

/** The verbs documented on a path, ignoring shared keys like `parameters`. */
const operationsOn = (pathItem: Record<string, unknown> = {}): string[] =>
  Object.keys(pathItem)
    .filter((key) => HTTP_METHODS.includes(key))
    .sort();

/**
 * Follows a single `$ref` into `components.schemas`. Nest emits a response
 * schema as a reference when the operation declares a DTO class, and inline
 * when it declares a literal shape; a reader of the document resolves either.
 */
function resolveSchema(document: OpenApiDocument, schema?: OpenApiSchema): OpenApiSchema {
  if (schema?.$ref === undefined) return schema ?? {};
  const name = schema.$ref.replace('#/components/schemas/', '');
  return document.components?.schemas?.[name] ?? {};
}

/** The header parameters an operation documents, in the case the document uses. */
const headerParametersOf = (operation: OpenApiOperation = {}): string[] =>
  (operation.parameters ?? []).filter((p) => p.in === 'header').map((p) => p.name);

describe('Feature: the application publishes its OpenAPI contract', () => {
  let world: BddWorld;

  beforeAll(async () => {
    world = await createBddWorld({ swagger: true });
  });

  beforeEach(async () => world.resetScenario());
  afterEach(() => world.verifyScenario());
  afterAll(async () => world?.close());

  describe('Scenario: the machine-readable document is served', () => {
    it(`Given an application with swagger mounted, When ${DOCS_JSON_PATH} is fetched, Then it answers with an identified OpenAPI document`, async () => {
      // Given
      // (the world was booted with the swagger flag on)

      // When
      const response = await request(world.app.getHttpServer()).get(DOCS_JSON_PATH);

      // Then
      expect(response.status).toBe(200);
      const document = response.body as OpenApiDocument;
      expect(typeof document.openapi).toBe('string');
      expect(document.openapi).toMatch(/^3\./);
      expect(typeof document.info?.title).toBe('string');
      expect(document.info?.title).not.toBe('');
    });
  });

  describe('Scenario: every route the application answers is documented', () => {
    it('Given the served OpenAPI document, When its paths are listed, Then they are exactly the published routes, each on its own verb', async () => {
      // Given
      const document = await readOpenApiDocument(world);

      // When
      const documented = Object.fromEntries(
        Object.entries(document.paths ?? {}).map(([path, item]) => [path, operationsOn(item)]),
      );

      // Then — an exact set, not a subset: a controller added without
      // documentation shows up here as an unexpected path and fails, which is
      // the only moment anyone is forced to notice it.
      expect(documented).toEqual(
        Object.fromEntries(
          Object.entries(DOCUMENTED_ROUTES).map(([path, methods]) => [path, [...methods].sort()]),
        ),
      );
    });
  });

  describe('Scenario: the achievements view documents its graded response shape', () => {
    it('Given the served OpenAPI document, When the 200 response schema for the achievements view is read, Then it carries exactly the five snake_case properties the contract names', async () => {
      // Given
      const document = await readOpenApiDocument(world);

      // When
      const operation = document.paths?.['/users/{user}/achievements']?.get;
      const schema = resolveSchema(
        document,
        operation?.responses?.['200']?.content?.['application/json']?.schema,
      );

      // Then
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
        [...ACHIEVEMENTS_RESPONSE_PROPERTIES].sort(),
      );
    });
  });

  describe('Scenario: the signed endpoints document the headers a caller must send', () => {
    it('Given the served OpenAPI document, When the storefront ingest operation is read, Then it documents both the signature and the timestamp header', async () => {
      // Given
      const document = await readOpenApiDocument(world);

      // When
      const headers = headerParametersOf(document.paths?.['/events']?.post);

      // Then — the storefront signs `{timestamp}.{body}`, so a caller that is
      // told about only one of the two headers cannot produce a valid request.
      expect(headers).toEqual(expect.arrayContaining(['x-signature', 'x-timestamp']));
    });

    it('Given the served OpenAPI document, When the paystack webhook operation is read, Then it documents the paystack signature header', async () => {
      // Given
      const document = await readOpenApiDocument(world);

      // When
      const headers = headerParametersOf(document.paths?.['/webhooks/paystack']?.post);

      // Then — a different header from the storefront's, and deliberately so:
      // the two signing schemes are never interchangeable.
      expect(headers).toEqual(expect.arrayContaining(['x-paystack-signature']));
    });
  });

  describe('Scenario: the browsable documentation is mounted', () => {
    it(`Given an application with swagger mounted, When ${DOCS_UI_PATH} is fetched, Then it answers with the swagger UI page`, async () => {
      // Given
      // (the world was booted with the swagger flag on)

      // When
      const response = await request(world.app.getHttpServer()).get(DOCS_UI_PATH);

      // Then
      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
      expect(response.text).toContain('swagger-ui');
    });
  });
});
