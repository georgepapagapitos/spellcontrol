import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { generateUsername } from '../auth';

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe('POST /api/auth/register', () => {
  it('creates a user and returns a session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'correct horse battery' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'alice' });
    expect(res.body.user.id).toBeTypeOf('string');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();
  });

  it('rejects duplicate usernames', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'another good password' });
    expect(res.status).toBe(409);
  });

  it('rejects short passwords', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'cory', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed usernames', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'BadUser!', password: 'correct horse battery' });
    expect(res.status).toBe(400);
  });

  it('lowercases usernames so case-only duplicates collide', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'dan', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'DAN', password: 'correct horse battery' });
    expect(res.status).toBe(409);
  });

  it('rejects a reserved username with a message distinct from "taken"', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admin', password: 'correct horse battery' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved/i);
  });
});

describe('generateUsername', () => {
  it('never surfaces a reserved local-part bare — advances to a numbered candidate', async () => {
    const username = await generateUsername('admin@example.com');
    expect(username).not.toBe('admin');
    expect(username).toMatch(/^admin\d+$/);
  });
});

describe('POST /api/auth/login', () => {
  it('returns a session cookie on valid credentials', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'eve', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'eve', password: 'correct horse battery' });
    expect(res.status).toBe(200);
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();
  });

  it('rejects wrong password with generic 401', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'frank', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'frank', password: 'wrong wrong wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns the same generic error for unknown users', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'correct horse battery' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the user with a valid session', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'helen', password: 'correct horse battery' });
    const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('helen');
  });

  it('includes an all-null profile for a fresh registration', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'freshprofile', password: 'correct horse battery' });
    const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({
      displayName: null,
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    const arr = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    expect(arr.some((c: string) => /spellcontrol_session=;/.test(c))).toBe(true);
  });
});

describe('DELETE /api/auth/me', () => {
  it('deletes the account and invalidates the session', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'iris', password: 'correct horse battery' });
    const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
    const del = await request(app).delete('/api/auth/me').set('Cookie', cookie);
    expect(del.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
  });
});

describe('PATCH /api/auth/profile', () => {
  const avatar = {
    cardId: '56ebc372-aabd-4174-a943-c7bf59e5049f',
    cardName: 'Sol Ring',
    imageUrl:
      'https://cards.scryfall.io/art_crop/front/5/6/56ebc372-aabd-4174-a943-c7bf59e5049f.jpg',
  };

  async function registerAndGetCookie(username: string): Promise<string> {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, password: 'correct horse battery' });
    return extractSessionCookie(reg.headers['set-cookie'])!;
  }

  it('sets all 3 fields in one call and reads them back via /me', async () => {
    const cookie = await registerAndGetCookie('profileuser1');
    const patch = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Pat', bio: 'Commander enjoyer', avatar });
    expect(patch.status).toBe(200);
    expect(patch.body.profile).toEqual({
      displayName: 'Pat',
      bio: 'Commander enjoyer',
      avatarCardId: avatar.cardId,
      avatarCardName: avatar.cardName,
      avatarImageUrl: avatar.imageUrl,
    });

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.profile).toEqual(patch.body.profile);
  });

  it('rejects a >40-char displayName', async () => {
    const cookie = await registerAndGetCookie('profileuser2');
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'a'.repeat(41) });
    expect(res.status).toBe(400);
  });

  it('rejects a reserved displayName', async () => {
    const cookie = await registerAndGetCookie('profileuser3');
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isn.t available/i);
  });

  it('clears a field via explicit null', async () => {
    const cookie = await registerAndGetCookie('profileuser4');
    await request(app).patch('/api/auth/profile').set('Cookie', cookie).send({ bio: 'temp bio' });
    const cleared = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ bio: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.profile.bio).toBeNull();
  });

  it('leaves a field untouched when its key is absent', async () => {
    const cookie = await registerAndGetCookie('profileuser5');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Stays' });
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ bio: 'only bio this time' });
    expect(res.status).toBe(200);
    expect(res.body.profile.displayName).toBe('Stays');
    expect(res.body.profile.bio).toBe('only bio this time');
  });

  it('rejects a non-Scryfall avatar imageUrl', async () => {
    const cookie = await registerAndGetCookie('profileuser6');
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ avatar: { ...avatar, imageUrl: 'https://evil.com/sol-ring.jpg' } });
    expect(res.status).toBe(400);
  });

  it('401s without a session', async () => {
    const res = await request(app).patch('/api/auth/profile').send({ displayName: 'Nope' });
    expect(res.status).toBe(401);
  });
});
