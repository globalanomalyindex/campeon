import './styles/tokens.css';
import './styles/base.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <main style="margin:auto;text-align:center">
      <p style="font-family:var(--font-display);font-style:italic;color:var(--slate-2)">aim sensitivity tool</p>
      <h1 style="font-family:var(--font-display);font-size:5rem;line-height:.9">campe<span style="color:var(--ink)">ó</span>n</h1>
    </main>`;
}
