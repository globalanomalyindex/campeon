import type { AppContext, Screen } from './shell';

function stub(title: string, note: string) {
  return (host: HTMLElement, ctx: AppContext): Screen => ({
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell stub fade-in';
      root.innerHTML = `<div class="wrap stack" style="margin:auto;text-align:center">
        <h2 class="display" style="font-size:2rem">+ ${title}</h2><p>${note}</p>
        <button class="action action--ghost" data-action="back">back</button></div>`;
      root.querySelector('[data-action="back"]')!.addEventListener('click', () => ctx.navigate('hero'));
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  });
}

export const optionsStub = stub('options', 'Conversion school, per-game yaw overrides, and search bounds arrive in the polish pass.');
