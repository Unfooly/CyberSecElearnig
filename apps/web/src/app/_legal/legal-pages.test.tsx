import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LEGAL_DOCUMENT_VERSION } from '@cyberszkolo/shared';
import TermsPage, { metadata as termsMeta } from '../regulamin/page';
import PrivacyPolicyPage, { metadata as privacyMeta } from '../polityka-prywatnosci/page';
import SecurityPage, { metadata as securityMeta } from '../bezpieczenstwo/page';
import { LandingFooter } from '../_landing/sections';

describe.each([
  ['Regulamin', TermsPage, termsMeta],
  ['Polityka prywatności', PrivacyPolicyPage, privacyMeta],
  ['Bezpieczeństwo', SecurityPage, securityMeta],
])('strona prawna: %s', (title, Page, meta) => {
  it('ma nagłówek, znacznik wersji roboczej i placeholdery [DO UZUPEŁNIENIA]', () => {
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(LEGAL_DOCUMENT_VERSION);
    expect(document.body.textContent).toContain('[DO UZUPEŁNIENIA]');
  });

  it('jest oznaczona noindex/nofollow', () => {
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe('stopka strony głównej', () => {
  it('linkuje do regulaminu, polityki prywatności i strony o bezpieczeństwie', () => {
    render(<LandingFooter />);

    expect(screen.getByRole('link', { name: 'Regulamin' })).toHaveAttribute('href', '/regulamin');
    expect(screen.getByRole('link', { name: 'Polityka prywatności' })).toHaveAttribute('href', '/polityka-prywatnosci');
    expect(screen.getByRole('link', { name: 'Bezpieczeństwo' })).toHaveAttribute('href', '/bezpieczenstwo');
  });
});
