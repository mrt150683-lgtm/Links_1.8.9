import { describe, it, expect } from 'vitest';
import { HealthResponseSchema, ErrorResponseSchema } from '../src/schemas.js';

describe('schemas', () => {
  describe('HealthResponseSchema', () => {
    it('should validate correct health response', () => {
      const valid = {
        ok: true,
        service: 'api',
        version: '0.1.0',
        time: Date.now(),
      };

      const result = HealthResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject invalid health response', () => {
      const invalid = {
        ok: 'yes', // should be boolean
        service: 'api',
      };

      const result = HealthResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('ErrorResponseSchema', () => {
    it('should validate error response', () => {
      const valid = {
        error: 'NotFoundError',
        message: 'Resource not found',
        statusCode: 404,
        request_id: 'req-123',
      };

      const result = ErrorResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate error response without request_id', () => {
      const valid = {
        error: 'ValidationError',
        message: 'Invalid input',
        statusCode: 400,
      };

      const result = ErrorResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });
});
