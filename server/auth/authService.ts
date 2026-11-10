import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { stateStore, type StoredAuthUser } from '../state/stateStore.ts';

export type AuthRole = StoredAuthUser['role'];
export interface PublicAuthUser {
  id: string;
  email: string;
  displayName: string;
  role: AuthRole;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicAuthUser;
    }
  }
}

const COOKIE_NAME = 'industrial_twin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, { userId: string; expiresAt: number }>();
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();
const DUMMY_SALT = 'industrial-twin-nonexistent-user-salt';
const DUMMY_HASH = passwordHash('not-a-real-password', DUMMY_SALT);

function publicUser(user: StoredAuthUser): PublicAuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function passwordHash(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function cookieValue(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  const pair = cookieHeader.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${COOKIE_NAME}=`));
  return pair?.slice(COOKIE_NAME.length + 1);
}

function setSessionCookie(response: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

export class AuthService {
  public ensureBootstrapAdmin(): void {
    const users = stateStore.getAuthUsers();
    if (users.some((user) => user.role === 'ADMIN')) return;

    const email = process.env.AUTH_ADMIN_EMAIL?.trim();
    const password = process.env.AUTH_ADMIN_PASSWORD;
    if (!email || !password) return;
    if (password.length < 12) {
      console.warn('[Auth] AUTH_ADMIN_PASSWORD must be at least 12 characters; admin bootstrap skipped.');
      return;
    }

    const salt = randomBytes(16).toString('hex');
    const admin: StoredAuthUser = {
      id: randomBytes(12).toString('hex'),
      email: normalizeEmail(email),
      displayName: 'System Administrator',
      role: 'ADMIN',
      passwordSalt: salt,
      passwordHash: passwordHash(password, salt),
      active: true,
      createdAt: Date.now(),
    };
    stateStore.storeAuthUsers([...users, admin]);
    stateStore.addAuditEvent({
      category: 'system',
      action: 'ADMIN_ACCOUNT_CREATED',
      actor: 'system-bootstrap',
      entityType: 'user',
      entityId: admin.id,
      status: 'SUCCESS',
      details: { email: admin.email },
    });
    console.info('[Auth] Initial admin account created from AUTH_ADMIN_EMAIL.');
  }

  public getSetupStatus(): { configured: boolean; adminExists: boolean } {
    this.ensureBootstrapAdmin();
    const users = stateStore.getAuthUsers();
    return {
      configured: users.some((user) => user.active && user.role === 'ADMIN'),
      adminExists: users.some((user) => user.role === 'ADMIN'),
    };
  }

  public getUser(request: Request): PublicAuthUser | null {
    const token = cookieValue(request);
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    const user = stateStore.getAuthUsers().find((item) => item.id === session.userId && item.active);
    return user ? publicUser(user) : null;
  }

  public login(emailInput: string, password: string, response: Response): PublicAuthUser | null {
    this.ensureBootstrapAdmin();
    const email = normalizeEmail(emailInput);
    const user = stateStore.getAuthUsers().find((item) => item.email === email && item.active);
    const candidate = passwordHash(password, user?.passwordSalt || DUMMY_SALT);
    const expected = user?.passwordHash || DUMMY_HASH;
    const matches = timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
    if (!user || !matches) return null;

    const token = randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(response, token);
    stateStore.addAuditEvent({
      category: 'system', action: 'USER_LOGIN', actor: user.displayName,
      entityType: 'user', entityId: user.id, status: 'SUCCESS', details: { role: user.role },
    });
    return publicUser(user);
  }

  public isLoginRateLimited(clientKey: string): boolean {
    const attempt = loginFailures.get(clientKey);
    if (!attempt) return false;
    if (attempt.lockedUntil <= Date.now()) {
      loginFailures.delete(clientKey);
      return false;
    }
    return attempt.count >= 5;
  }

  public recordFailedLogin(clientKey: string): void {
    const attempt = loginFailures.get(clientKey) || { count: 0, lockedUntil: 0 };
    attempt.count += 1;
    if (attempt.count >= 5) attempt.lockedUntil = Date.now() + 15 * 60 * 1000;
    loginFailures.set(clientKey, attempt);
  }

  public clearLoginFailures(clientKey: string): void {
    loginFailures.delete(clientKey);
  }

  public logout(request: Request, response: Response): void {
    const token = cookieValue(request);
    const user = this.getUser(request);
    if (token) sessions.delete(token);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
    if (user) {
      stateStore.addAuditEvent({
        category: 'system', action: 'USER_LOGOUT', actor: user.displayName,
        entityType: 'user', entityId: user.id, status: 'INFO', details: { role: user.role },
      });
    }
  }

  public listUsers(): Array<PublicAuthUser & { active: boolean; createdAt: number }> {
    return stateStore.getAuthUsers().map(({ id, email, displayName, role, active, createdAt }) =>
      ({ id, email, displayName, role, active, createdAt }));
  }

  public createUser(input: { email: string; displayName: string; role: AuthRole; password: string }, actor: PublicAuthUser): PublicAuthUser {
    const email = normalizeEmail(input.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    if (input.displayName.trim().length < 2) throw new Error('Display name must have at least 2 characters.');
    if (!['ADMIN', 'ENGINEER', 'OPERATOR', 'TECHNICIAN'].includes(input.role)) throw new Error('Choose a valid role.');
    if (input.password.length < 12) throw new Error('Password must have at least 12 characters.');
    const users = stateStore.getAuthUsers();
    if (users.some((user) => user.email === email)) throw new Error('A user with that email already exists.');
    const salt = randomBytes(16).toString('hex');
    const user: StoredAuthUser = {
      id: randomBytes(12).toString('hex'), email, displayName: input.displayName.trim(), role: input.role,
      passwordSalt: salt, passwordHash: passwordHash(input.password, salt), active: true, createdAt: Date.now(),
    };
    stateStore.storeAuthUsers([...users, user]);
    stateStore.addAuditEvent({
      category: 'system', action: 'USER_CREATED', actor: actor.displayName,
      entityType: 'user', entityId: user.id, status: 'SUCCESS',
      details: { email: user.email, role: user.role },
    });
    return publicUser(user);
  }

  public setUserActive(userId: string, active: boolean, actor: PublicAuthUser): void {
    const users = stateStore.getAuthUsers();
    const target = users.find((user) => user.id === userId);
    if (!target) throw new Error('User not found.');
    if (target.id === actor.id && !active) throw new Error('You cannot disable your own account.');
    if (target.role === 'ADMIN' && active === false && users.filter((user) => user.role === 'ADMIN' && user.active).length === 1) {
      throw new Error('At least one active admin account is required.');
    }
    target.active = active;
    stateStore.storeAuthUsers(users);
    if (!active) {
      for (const [token, session] of sessions) if (session.userId === userId) sessions.delete(token);
    }
    stateStore.addAuditEvent({
      category: 'system', action: active ? 'USER_ENABLED' : 'USER_DISABLED', actor: actor.displayName,
      entityType: 'user', entityId: target.id, status: 'SUCCESS', details: { email: target.email, role: target.role },
    });
  }
}

export const authService = new AuthService();

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const user = authService.getUser(request);
  if (!user) {
    response.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  request.authUser = user;
  next();
}

export function requireRole(...roles: AuthRole[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.authUser || !roles.includes(request.authUser.role)) {
      response.status(403).json({ error: 'Your account does not have permission to do that.' });
      return;
    }
    next();
  };
}
