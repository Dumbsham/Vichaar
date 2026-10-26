import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  VersionConflictError,
  SubscriptionRequiredError,
  SendingPausedError,
  isAppError,
} from '../src/errors.js';
import { SystemClock, FakeClock } from '../src/clock.js';
import { signToken, verifyToken } from '../src/tokens.js';
import {
  signupSchema,
  loginSchema,
  createPublicationSchema,
  createPostSchema,
  updatePostSchema,
  publishPostSchema,
  cursorPaginationSchema,
} from '../src/schemas/index.js';

describe('Shared Errors', () => {
  it('instantiates typed errors with correct status codes and codes', () => {
    const baseError = new AppError('Base system error', 500, 'INTERNAL_SERVER_ERROR');
    expect(baseError.statusCode).toBe(500);
    expect(baseError.code).toBe('INTERNAL_SERVER_ERROR');
    expect(isAppError(baseError)).toBe(true);

    const notFound = new NotFoundError('Post not found');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe('NOT_FOUND');
    expect(isAppError(notFound)).toBe(true);

    const forbidden = new ForbiddenError();
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.code).toBe('FORBIDDEN');

    const validation = new ValidationError('Bad request', { field: 'email' });
    expect(validation.statusCode).toBe(400);
    expect(validation.code).toBe('VALIDATION_ERROR');
    expect(validation.details).toEqual({ field: 'email' });

    const conflict = new ConflictError('Email already registered');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.code).toBe('CONFLICT');

    const versionConflict = new VersionConflictError();
    expect(versionConflict.statusCode).toBe(409);
    expect(versionConflict.code).toBe('VERSION_CONFLICT');

    const subRequired = new SubscriptionRequiredError();
    expect(subRequired.statusCode).toBe(403);
    expect(subRequired.code).toBe('SUBSCRIPTION_REQUIRED');

    const sendingPaused = new SendingPausedError();
    expect(sendingPaused.statusCode).toBe(422);
    expect(sendingPaused.code).toBe('SENDING_PAUSED');

    expect(isAppError(new Error('Generic'))).toBe(false);
  });
});

describe('Shared Clock', () => {
  it('SystemClock provides live timestamps', () => {
    const clock = new SystemClock();
    const now = clock.now();
    expect(now).toBeInstanceOf(Date);
    expect(clock.epochMs()).toBeGreaterThan(0);
    expect(typeof clock.isoNow()).toBe('string');
  });

  it('FakeClock advances deterministically', () => {
    const start = '2026-10-21T10:00:00.000Z';
    const clock = new FakeClock(start);

    expect(clock.isoNow()).toBe(start);

    clock.advanceSeconds(30);
    expect(clock.isoNow()).toBe('2026-10-21T10:00:30.000Z');

    clock.advanceMinutes(15);
    expect(clock.isoNow()).toBe('2026-10-21T10:15:30.000Z');

    clock.advanceDays(2);
    expect(clock.isoNow()).toBe('2026-10-23T10:15:30.000Z');

    clock.setTime('2026-12-31T23:59:59.000Z');
    expect(clock.isoNow()).toBe('2026-12-31T23:59:59.000Z');
  });
});

describe('Shared Tokens (HMAC-SHA256)', () => {
  const secret = 'super-secret-key-32-chars-minimum-safe';

  it('signs and verifies payload successfully', () => {
    const payload = { subId: '123', postId: '456', action: 'unsubscribe' };
    const token = signToken(payload, secret);

    expect(typeof token).toBe('string');
    expect(token.includes('.')).toBe(true);

    const verified = verifyToken<typeof payload>(token, secret);
    expect(verified).toEqual(payload);
  });

  it('rejects tampered tokens', () => {
    const token = signToken({ user: 'alice' }, secret);
    const tampered = token.slice(0, -3) + 'abc';

    expect(verifyToken(tampered, secret)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const expiredSeconds = Math.floor(Date.now() / 1000) - 100;
    const token = signToken({ user: 'bob', exp: expiredSeconds }, secret);

    expect(verifyToken(token, secret)).toBeNull();
  });

  it('rejects invalid token formats', () => {
    expect(verifyToken('', secret)).toBeNull();
    expect(verifyToken('invalid-no-dot', secret)).toBeNull();
  });
});

describe('Shared Zod Schemas', () => {
  it('validates signup and normalizes email', () => {
    const valid = signupSchema.parse({
      email: ' Test@Example.Com ',
      password: 'password123',
      name: 'Writer Name',
    });
    expect(valid.email).toBe('test@example.com');
    expect(valid.timezone).toBe('Asia/Kolkata');

    expect(() => signupSchema.parse({ email: 'bad-email', password: 'short', name: '' })).toThrow();
  });

  it('validates login input', () => {
    const valid = loginSchema.parse({
      email: ' Writer@Example.Com ',
      password: 'mypassword',
    });
    expect(valid.email).toBe('writer@example.com');
    expect(valid.password).toBe('mypassword');

    expect(() => loginSchema.parse({ email: 'not-an-email', password: '' })).toThrow();
  });

  it('validates publication subdomains with strict rules', () => {
    const valid = createPublicationSchema.parse({
      name: 'Tech Chronicle',
      subdomain: 'tech-chronicle',
      monthlyPricePaise: 50000,
    });
    expect(valid.subdomain).toBe('tech-chronicle');
    expect(valid.monthlyPricePaise).toBe(50000);

    // Subdomain must not start or end with hyphen, nor have uppercase
    expect(() => createPublicationSchema.parse({ name: 'Blog', subdomain: '-bad' })).toThrow();
    expect(() => createPublicationSchema.parse({ name: 'Blog', subdomain: 'bad-' })).toThrow();
    expect(() => createPublicationSchema.parse({ name: 'Blog', subdomain: 'ab' })).toThrow(); // min 3 chars
    expect(() =>
      createPublicationSchema.parse({ name: 'Blog', subdomain: 'Invalid_Name' }),
    ).toThrow();
    expect(() =>
      createPublicationSchema.parse({
        name: 'Sender\r\nBcc: victim@example.test',
        subdomain: 'safe-name',
      }),
    ).toThrow();
  });

  it('accepts language-aware post slugs', () => {
    expect(createPostSchema.parse({ title: 'हिंदी कहानी', slug: 'हिंदी-कहानी' }).slug).toBe(
      'हिंदी-कहानी',
    );
    expect(createPostSchema.parse({ title: 'Café notes', slug: 'café-notes' }).slug).toBe(
      'café-notes',
    );
  });

  it('validates post updates requiring version for optimistic locking', () => {
    const valid = updatePostSchema.parse({
      version: 2,
      title: 'Updated Title',
    });
    expect(valid.version).toBe(2);

    // Missing version must fail
    expect(() => updatePostSchema.parse({ title: 'No version' })).toThrow();
    expect(() =>
      updatePostSchema.parse({ version: 2, title: 'Story\r\nBcc: victim@example.test' }),
    ).toThrow();
  });

  it('validates publish post schema with sendImmediately flag', () => {
    const defaultPublish = publishPostSchema.parse({});
    expect(defaultPublish.sendImmediately).toBe(false);

    const immediatePublish = publishPostSchema.parse({ sendImmediately: true });
    expect(immediatePublish.sendImmediately).toBe(true);
  });

  it('validates cursor pagination with coerced limits and bounds', () => {
    const parsed = cursorPaginationSchema.parse({ limit: '50', cursor: 'opaque-cursor' });
    expect(parsed.limit).toBe(50);
    expect(parsed.cursor).toBe('opaque-cursor');

    const defaultParsed = cursorPaginationSchema.parse({});
    expect(defaultParsed.limit).toBe(25);

    expect(() => cursorPaginationSchema.parse({ limit: 0 })).toThrow();
    expect(() => cursorPaginationSchema.parse({ limit: 150 })).toThrow();
  });
});
