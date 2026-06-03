import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('options wiring', () => {
  it('main.ts uses the real options screen + stylesheet, and no stubs remain', () => {
    const main = readFileSync('src/main.ts', 'utf-8');
    expect(main).toMatch(/import\s*\{\s*options\s*\}\s*from\s*'\.\/ui\/options\/options'/);
    expect(main).toMatch(/styles\/options\.css/);
    expect(main).not.toMatch(/optionsStub/);
    expect(main).not.toMatch(/\.\/ui\/stubs/);
  });
});
