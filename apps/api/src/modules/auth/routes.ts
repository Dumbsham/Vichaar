import { Router } from 'express';
import { signupSchema, loginSchema } from './schemas.js';
import type { AuthService } from './service.js';

export function createAuthRouter({ authService }: { authService: AuthService }): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
  router.post('/signup', async (req, res) => {
    const result = await authService.signup(signupSchema.parse(req.body));
    res.cookie('vichaar_session', result.token, {
      ...cookieOptions,
      expires: new Date(result.expiresAt),
    });
    res.status(201).json({ user: result.user, expiresAt: result.expiresAt });
  });
  router.post('/login', async (req, res) => {
    const result = await authService.login(loginSchema.parse(req.body));
    res.cookie('vichaar_session', result.token, {
      ...cookieOptions,
      expires: new Date(result.expiresAt),
    });
    res.json({ user: result.user, expiresAt: result.expiresAt });
  });
  router.post('/logout', async (req, res) => {
    await authService.logout(req.cookies?.vichaar_session);
    res.clearCookie('vichaar_session', cookieOptions);
    res.status(204).send();
  });
  return router;
}
