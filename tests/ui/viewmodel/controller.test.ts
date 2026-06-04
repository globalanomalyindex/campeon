import { describe, it, expect } from 'vitest';
import { ViewmodelController } from '../../../src/ui/viewmodel/controller';
import { ANIMATIONS } from '../../../src/ui/viewmodel/atlas';

describe('ViewmodelController', () => {
  it('defaults to idle-ready and reports the current animation', () => {
    const vm = new ViewmodelController();
    expect(vm.current()).toBe('idleReady');
    expect(vm.frameAt(0).name).toBe('idleReady');
  });

  it('auto-advances a one-shot to its queued follow-up once it completes', () => {
    const vm = new ViewmodelController('idleReady', 0);
    vm.play('flickDraw', 1000, 'idleReady');
    expect(vm.frameAt(1100).name).toBe('flickDraw'); // still drawing
    const fdDoneMs = 1000 + (ANIMATIONS.flickDraw.to - ANIMATIONS.flickDraw.from + 1) / ANIMATIONS.flickDraw.fps * 1000 + 5;
    expect(vm.frameAt(fdDoneMs).name).toBe('idleReady'); // advanced to the follow-up
  });

  it('does not advance a one-shot with no follow-up - it clamps on its last frame', () => {
    const vm = new ViewmodelController('idleReady', 0);
    vm.play('fire', 0); // no `then`
    expect(vm.frameAt(10_000).name).toBe('fire');
  });

  it('a looping animation plays indefinitely (never auto-advances)', () => {
    const vm = new ViewmodelController('idleReady', 0);
    vm.play('smoking', 0, 'idleReady'); // even with a follow-up queued, a loop never completes
    expect(vm.frameAt(50_000).name).toBe('smoking');
  });
});
