import './styles/tokens.css';
import './styles/base.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

function renderPlaceholder(root: HTMLDivElement): void {
  root.innerHTML = `
    <main style="margin:auto;text-align:center">
      <p style="font-family:var(--font-display);font-style:italic;color:var(--slate-2)">aim sensitivity tool</p>
      <h1 style="font-family:var(--font-display);font-size:5rem;line-height:.9">campe<span style="color:var(--ink)">ó</span>n</h1>
      <p style="font-family:var(--font-mono);color:var(--slate-2);margin-top:1rem">
        dev: <a href="#arena" style="color:var(--gold)">#arena</a> — input + engine harness
      </p>
    </main>`;
}

async function route(root: HTMLDivElement): Promise<void> {
  if (window.location.hash === '#arena') {
    const { mountArenaHarness } = await import('./dev/arena-harness');
    mountArenaHarness(root);
  } else {
    root.style.cssText = '';
    renderPlaceholder(root);
  }
}

window.addEventListener('hashchange', () => {
  void route(app);
});
void route(app);
