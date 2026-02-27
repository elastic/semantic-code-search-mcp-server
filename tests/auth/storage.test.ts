import Redis from 'ioredis';

import { MemoryOAuthStorage } from '../../src/auth/storage/memory';
import { RedisOAuthStorage } from '../../src/auth/storage/redis';

jest.mock('ioredis');

describe('storage', () => {
  test('MemoryOAuthStorage lock prevents concurrent acquisition', async () => {
    const s = new MemoryOAuthStorage();
    const t1 = await s.acquireLock('k', 1);
    expect(typeof t1).toBe('string');
    const t2 = await s.acquireLock('k', 1);
    expect(t2).toBeNull();
    await s.releaseLock('k', t1!);
    const t3 = await s.acquireLock('k', 1);
    expect(typeof t3).toBe('string');
  });

  test('RedisOAuthStorage uses SET EX NX for locks', async () => {
    const setMock = jest.fn().mockResolvedValue('OK');
    const evalMock = jest.fn().mockResolvedValue(1);
    (Redis as unknown as jest.Mock).mockImplementation(() => ({
      set: setMock,
      eval: evalMock,
      get: jest.fn(),
      del: jest.fn(),
    }));

    const s = new RedisOAuthStorage('redis://example');
    const token = await s.acquireLock('lk', 5);
    expect(typeof token).toBe('string');
    expect(setMock).toHaveBeenCalledWith('lk', expect.any(String), 'EX', 5, 'NX');

    await s.releaseLock('lk', token!);
    expect(evalMock).toHaveBeenCalled();
  });
});
