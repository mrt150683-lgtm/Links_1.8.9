/**
 * Phase 11: Extension Rate Limiting Middleware
 *
 * Rate limits extension requests to 60/minute per token.
 * Uses in-memory token bucket algorithm.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

// In-memory rate limit store (per token hash)
// Key: first 8 chars of token (for privacy in logs)
// Value: token bucket state
const rateLimitStore = new Map<string, TokenBucket>();

// Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute
const REFILL_RATE = RATE_LIMIT_MAX_REQUESTS / RATE_LIMIT_WINDOW_MS; // tokens per ms

/**
 * Extract token from request headers
 *
 * Same logic as extAuth middleware
 */
function extractToken(request: FastifyRequest): string | null {
  // Try Authorization: Bearer <token>
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Try X-Ext-Token: <token>
  const extTokenHeader = request.headers['x-ext-token'];
  if (typeof extTokenHeader === 'string') {
    return extTokenHeader;
  }

  return null;
}

/**
 * Get token identifier for rate limiting
 *
 * Uses first 8 chars of token as key (privacy)
 */
function getTokenKey(token: string): string {
  return token.substring(0, 8);
}

/**
 * Refill token bucket based on elapsed time
 */
function refillBucket(bucket: TokenBucket, now: number): void {
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = elapsed * REFILL_RATE;

  bucket.tokens = Math.min(
    RATE_LIMIT_MAX_REQUESTS,
    bucket.tokens + tokensToAdd
  );
  bucket.lastRefill = now;
}

/**
 * Check if request is allowed under rate limit
 */
function isAllowed(tokenKey: string): boolean {
  const now = Date.now();

  // Get or create bucket
  let bucket = rateLimitStore.get(tokenKey);
  if (!bucket) {
    bucket = {
      tokens: RATE_LIMIT_MAX_REQUESTS,
      lastRefill: now,
    };
    rateLimitStore.set(tokenKey, bucket);
  }

  // Refill tokens based on elapsed time
  refillBucket(bucket, now);

  // Check if we have tokens available
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}

/**
 * Extension rate limiting middleware
 *
 * Limits requests to 60/minute per token
 * Returns 429 if rate limit exceeded
 */
export async function rateLimitExtMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    // No token - will be caught by extAuth middleware
    // Skip rate limiting here
    return;
  }

  const tokenKey = getTokenKey(token);

  if (!isAllowed(tokenKey)) {
    return reply.status(429).send({
      ok: false,
      error: 'Rate limit exceeded',
      details: `Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per minute`,
      retry_after_seconds: Math.ceil(
        (1 - (rateLimitStore.get(tokenKey)?.tokens ?? 0)) / REFILL_RATE / 1000
      ),
    });
  }

  // Request allowed, continue
}

/**
 * Cleanup old rate limit entries
 *
 * Should be called periodically (e.g., every 5 minutes)
 * Removes buckets that haven't been used in 10 minutes
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  const staleThreshold = 10 * 60 * 1000; // 10 minutes

  for (const [key, bucket] of rateLimitStore.entries()) {
    if (now - bucket.lastRefill > staleThreshold) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
