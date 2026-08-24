import {
  PURCHASE_EVENT_EXAMPLE,
  PurchaseEventBody,
  purchaseEventSchema,
} from './purchase-event.dto';

/**
 * The OpenAPI body class and the zod schema describe the same payload but are
 * enforced by different mechanisms, so nothing stops them drifting apart. This
 * closes that gap in the only direction that matters to a caller: documentation
 * must never describe a body the service would reject.
 */
describe('Feature: the documented ingest body matches the schema that validates it', () => {
  describe('Scenario: a caller sends exactly what the documentation shows', () => {
    it('accepts the documented example', () => {
      // Given
      const documented = PURCHASE_EVENT_EXAMPLE;

      // When
      const result = purchaseEventSchema.safeParse(documented);

      // Then
      expect(result.success).toBe(true);
    });
  });

  describe('Scenario: the documented body class gains or loses a field', () => {
    it('describes exactly the fields the schema requires', () => {
      // Given
      const documentedFields = Object.keys(PURCHASE_EVENT_EXAMPLE).sort();

      // When
      const schemaFields = Object.keys(purchaseEventSchema.shape).sort();

      // Then
      // `PurchaseEventBody implements PurchaseEvent` already makes the compiler
      // reject a missing field; this catches the runtime half — an example that
      // stops matching, or a schema field nobody documented.
      expect(documentedFields).toEqual(schemaFields);
      const bodyType: PurchaseEventBody = { ...PURCHASE_EVENT_EXAMPLE };
      expect(Object.keys(bodyType).sort()).toEqual(schemaFields);
    });
  });
});
