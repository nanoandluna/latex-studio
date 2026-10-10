import { expect, it } from 'vitest';
import { literatureLink } from '../src/components/citations/CitationWorkspacePanel';
it('opens canonical DOI and web URLs while rejecting executable and local protocols', () => {
  expect(literatureLink({ doi: 'https://doi.org/10.1234/example' })).toBe('https://doi.org/10.1234/example');
  expect(literatureLink({ url: 'https://example.org/paper' })).toBe('https://example.org/paper');
  for (const url of ['javascript:alert(1)', 'file:///private.tex', 'data:text/html,test']) expect(literatureLink({ url })).toBeNull();
});
