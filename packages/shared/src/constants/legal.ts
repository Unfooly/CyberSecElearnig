// Wersje dokumentów prawnych zapisywane przy akceptacji (LegalAcceptance).
// "draft-1" do czasu dostarczenia treści prawnych; po ich publikacji podbij
// wersję - nowi użytkownicy zapiszą nową, a zapis starych zostanie jako dowód.
export const LEGAL_DOCUMENT_VERSION = 'draft-1';

// Kraj rejestracji firm na start: tylko Polska (NIP z sumą kontrolną).
export const REGISTRATION_COUNTRY = 'PL';

// Kod pocztowy PL: NN-NNN.
export const PL_POSTAL_CODE_REGEX = /^\d{2}-\d{3}$/;
