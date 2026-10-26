import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import type { Clock } from '@vichaar/shared/clock';
import { ConflictError, UnauthorizedError } from '@vichaar/shared/errors';
import type { SignupInput, LoginInput } from '@vichaar/shared/schemas';
import type { AuthRepository, AuthUser } from './repository.js';

const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const dummyHash = await argon2.hash('not-a-real-user-password', { type: argon2.argon2id });
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.display_name,
    timezone: user.timezone,
    createdAt: user.created_at.toISOString(),
  };
}
export interface AuthService {
  signup(
    input: SignupInput,
  ): Promise<{ token: string; user: ReturnType<typeof publicUser>; expiresAt: string }>;
  login(
    input: LoginInput,
  ): Promise<{ token: string; user: ReturnType<typeof publicUser>; expiresAt: string }>;
  authenticate(token: string | undefined): Promise<AuthUser>;
  logout(token: string | undefined): Promise<void>;
}
export function createAuthService({
  authRepo,
  clock,
}: {
  authRepo: AuthRepository;
  clock: Clock;
}): AuthService {
  async function newSession(user: AuthUser) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(clock.epochMs() + SESSION_AGE_MS);
    await authRepo.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
    return { token, user: publicUser(user), expiresAt: expiresAt.toISOString() };
  }
  return {
    async signup(input) {
      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const user = await authRepo.createUser({
        email: input.email,
        passwordHash,
        name: input.name,
        timezone: input.timezone,
      });
      if (!user) throw new ConflictError('Account already exists');
      return newSession(user);
    },
    async login(input) {
      const user = await authRepo.findUserByEmail(input.email);
      const valid = await argon2.verify(user?.password_hash ?? dummyHash, input.password);
      if (!user || !valid) throw new UnauthorizedError('Invalid credentials');
      return newSession(user);
    },
    async authenticate(token) {
      if (!token) throw new UnauthorizedError();
      const user = await authRepo.findSession(hashSessionToken(token), clock.now());
      if (!user) throw new UnauthorizedError();
      return user;
    },
    async logout(token) {
      if (token) await authRepo.deleteSession(hashSessionToken(token));
    },
  };
}
