// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { bindRangeLock } from '../../src/ui/range-lock';

/** Flush the promise microtask chain the binder runs (request -> ready -> start). */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness(opts: { locked?: boolean; reject?: boolean } = {}) {
  const calls = { request: 0, start: 0 };
  let locked = opts.locked ?? false;
  let reject = opts.reject ?? false;
  const canvas = document.createElement('canvas');
  const unbind = bindRangeLock(canvas, {
    isLocked: () => locked,
    requestLock: () => {
      calls.request += 1;
      if (reject) return Promise.reject(new Error('lock denied (cooldown)'));
      locked = true; // a granted lock flips the (fake) pointer-lock state
      return Promise.resolve('raw');
    },
    ready: Promise.resolve(),
    start: () => {
      calls.start += 1;
    },
  });
  return {
    canvas,
    calls,
    unbind,
    click: () => canvas.dispatchEvent(new MouseEvent('click')),
    esc: () => {
      locked = false; // the browser released the lock (Esc)
    },
    setReject: (v: boolean) => {
      reject = v;
    },
  };
}

describe('bindRangeLock - the range must survive Esc -> click relocks', () => {
  it('first click locks then starts free play exactly once', async () => {
    const h = harness();
    h.click();
    await flush();
    expect(h.calls.request).toBe(1);
    expect(h.calls.start).toBe(1);
  });

  it('REGRESSION: after Esc releases the lock, the next click relocks (no {once:true} death)', async () => {
    const h = harness();
    h.click();
    await flush();
    h.esc(); // player pressed Esc - browser released the pointer lock
    h.click(); // ...and clicked to get back in. This is where {once:true} silently died.
    await flush();
    expect(h.calls.request).toBe(2); // the relock actually happened
    expect(h.calls.start).toBe(1); // but free play did NOT restart (no double init/subscription leak)
  });

  it('clicks while locked are shots, not lock requests (no re-request spam per trigger pull)', async () => {
    const h = harness();
    h.click();
    await flush();
    h.click(); // still locked - this is the player firing
    h.click();
    await flush();
    expect(h.calls.request).toBe(1);
  });

  it('a DENIED lock (browser cooldown after Esc) does not start free play unlocked, and a later click retries', async () => {
    const h = harness({ reject: true });
    h.click();
    await flush();
    expect(h.calls.request).toBe(1);
    expect(h.calls.start).toBe(0); // you cannot aim without a lock - starting would be a dead range
    h.setReject(false); // cooldown over
    h.click();
    await flush();
    expect(h.calls.request).toBe(2);
    expect(h.calls.start).toBe(1);
  });

  it('start still fires only once across a lock -> Esc -> relock cycle', async () => {
    const h = harness();
    h.click();
    await flush();
    h.esc();
    h.click();
    await flush();
    h.esc();
    h.click();
    await flush();
    expect(h.calls.start).toBe(1);
    expect(h.calls.request).toBe(3);
  });

  it('unbind removes the listener (no zombie lock requests after unmount)', async () => {
    const h = harness();
    h.unbind();
    h.click();
    await flush();
    expect(h.calls.request).toBe(0);
  });
});
