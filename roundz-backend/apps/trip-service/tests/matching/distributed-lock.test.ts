import { describe, expect, it } from 'vitest';
import { InMemoryDistributedLock } from '@roundz/redis';

describe('distributed lock', () => {
  it('grants a lock and blocks a second acquirer until released', async () => {
    const lock = new InMemoryDistributedLock();
    const first = await lock.acquire('trip:1', 1000);
    expect(first).not.toBeNull();

    const second = await lock.acquire('trip:1', 1000);
    expect(second).toBeNull();

    await lock.release(first!);
    const third = await lock.acquire('trip:1', 1000);
    expect(third).not.toBeNull();
  });

  it('only the owner can release a lock (fencing token)', async () => {
    const lock = new InMemoryDistributedLock();
    const handle = await lock.acquire('trip:2', 1000);
    expect(handle).not.toBeNull();

    await lock.release({ key: 'trip:2', token: 'someone-elses-token' });
    // Still held: a fresh acquire must fail.
    expect(await lock.acquire('trip:2', 1000)).toBeNull();
  });

  it('expires the lock after its TTL', async () => {
    const lock = new InMemoryDistributedLock();
    const handle = await lock.acquire('trip:3', 5);
    expect(handle).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(await lock.acquire('trip:3', 1000)).not.toBeNull();
  });

  it('withLock returns null without running the task when contended', async () => {
    const lock = new InMemoryDistributedLock();
    const held = await lock.acquire('trip:4', 1000);
    expect(held).not.toBeNull();

    let ran = false;
    const result = await lock.withLock('trip:4', 1000, async () => {
      ran = true;
      return 'done';
    });

    expect(ran).toBe(false);
    expect(result).toBeNull();
  });

  it('withLock releases the lock even if the task throws', async () => {
    const lock = new InMemoryDistributedLock();
    await expect(
      lock.withLock('trip:5', 1000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await lock.acquire('trip:5', 1000)).not.toBeNull();
  });
});
