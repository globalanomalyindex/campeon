import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('case-study wiring', () => {
  it('main.ts imports the real caseStudy screen and the stylesheet, not the stub', () => {
    const main = readFileSync('src/main.ts', 'utf-8');
    expect(main).toMatch(/import\s*\{\s*caseStudy\s*\}\s*from\s*'\.\/ui\/case-study\/case-study'/);
    expect(main).toMatch(/styles\/case-study\.css/);
    expect(main).not.toMatch(/caseStudyStub/);
  });
});
