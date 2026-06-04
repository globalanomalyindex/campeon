import type { AppContext, Screen } from './shell';
import type { PointerLockMode } from '../types';
import { createPointerLock } from '../input/pointer-lock';
import { AccelMeter, accelVerdict } from '../input/accel-check';

export type GateStep = 'intro' | 'accel' | 'blocked' | 'ready';

export interface GateState {
  step: GateStep;
  mode: PointerLockMode | null;
  slow: number;
  fast: number;
  blocked: boolean;
}

export type GateAction =
  | { type: 'locked'; mode: PointerLockMode }
  | { type: 'accel'; slow: number; fast: number }
  | { type: 'retry' };

/** Pure transition for the validity gate. The accel rule delegates to accelVerdict (single source). */
export function gateReducer(state: GateState, action: GateAction): GateState {
  switch (action.type) {
    case 'locked':
      return { ...state, step: 'accel', mode: action.mode };
    case 'accel': {
      const blocked = accelVerdict(action.slow, action.fast).accelerated;
      return {
        ...state,
        slow: action.slow,
        fast: action.fast,
        blocked,
        step: blocked ? 'blocked' : 'ready',
      };
    }
    case 'retry':
      return { ...state, step: 'accel', blocked: false, slow: 0, fast: 0 };
  }
}

export function gate(host: HTMLElement, ctx: AppContext): Screen {
  let state: GateState = { step: 'intro', mode: null, slow: 0, fast: 0, blocked: false };
  const pointer = createPointerLock(host);
  let meter: AccelMeter | null = null;
  const offSample = pointer.onSample((s) => meter?.add(s));

  function dispatch(action: GateAction): void {
    state = gateReducer(state, action);
    render();
  }

  function render(): void {
    host.replaceChildren(
      buildStepDom(state, {
        onEnter: () =>
          void pointer
            .request()
            .then(() =>
              dispatch({ type: 'locked', mode: pointer.mode() ?? 'os-adjusted' }),
            )
            .catch(() => dispatch({ type: 'locked', mode: 'os-adjusted' })),
        onStartSlow: () => {
          meter = new AccelMeter();
        },
        onStopSlow: () => {
          state = { ...state, slow: meter?.total() ?? 0 };
          meter = null;
          render();
        },
        onStartFast: () => {
          meter = new AccelMeter();
        },
        onStopFast: () => {
          dispatch({ type: 'accel', slow: state.slow, fast: meter?.total() ?? 0 });
          meter = null;
        },
        onRetry: () => dispatch({ type: 'retry' }),
        onContinue: () => ctx.navigate('session'),
      }),
    );
  }

  return {
    mount() {
      render();
    },
    unmount() {
      offSample();
      pointer.dispose();
      host.replaceChildren();
    },
  };
}

interface GateHandlers {
  onEnter(): void;
  onStartSlow(): void;
  onStopSlow(): void;
  onStartFast(): void;
  onStopFast(): void;
  onRetry(): void;
  onContinue(): void;
}

/** Per-step DOM for the gate. Dark (screen--arena), keyboard-accessible, brand-faithful. */
function buildStepDom(state: GateState, h: GateHandlers): HTMLElement {
  const root = document.createElement('section');
  root.className = 'screen screen--arena gate fade-in';

  const wrap = document.createElement('div');
  wrap.className = 'wrap stack gate__inner';

  const btn = (
    label: string,
    onClick: () => void,
    primary = true,
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = `action ${primary ? 'action--primary' : 'action--ghost'}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  const p = (text: string, cls = ''): HTMLParagraphElement => {
    const el = document.createElement('p');
    el.className = cls;
    el.textContent = text;
    return el;
  };

  if (state.step === 'intro') {
    wrap.append(
      p(
        'We need true, unaccelerated mouse input. Click to lock the pointer.',
        'gate__lead',
      ),
      btn('enter the arena', h.onEnter),
    );
  } else if (state.step === 'accel') {
    wrap.append(
      p(
        `lock: ${state.mode ?? '-'} ${
          state.mode === 'raw'
            ? '(raw - Chromium)'
            : '(reduced validity - verify acceleration is off)'
        }`,
        'mono',
      ),
      p(
        'Swipe the SAME physical distance slowly, then quickly. We compare the totals.',
        'gate__lead',
      ),
      btn('start slow swipe', h.onStartSlow, false),
      btn('stop slow', h.onStopSlow, false),
      btn('start fast swipe', h.onStartFast, false),
      btn('stop fast → check', h.onStopFast),
    );
  } else if (state.step === 'blocked') {
    wrap.append(
      p(
        'Mouse acceleration appears to be ON - cm/360 is undefined under acceleration.',
        'gate__lead',
      ),
      p(
        'Turn off OS/driver mouse acceleration ("Enhance pointer precision"), then retry.',
      ),
      btn('retry', h.onRetry),
    );
  } else {
    wrap.append(
      p('From here, everything is cm/360.', 'gate__lead'),
      btn('continue', h.onContinue),
    );
  }

  root.appendChild(wrap);
  return root;
}
