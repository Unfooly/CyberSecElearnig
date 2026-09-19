// Podmiana odpowiedzi DNS TYLKO dla procesu API uruchamianego przez
// scripts/e2e-registration.mjs (node -r ./scripts/e2e/dns-stub.cjs ...).
// Prawdziwy NodeDnsTxtResolver dalej działa (timeouty, łączenie fragmentów),
// ale zamiast sieci dostaje rekord z pliku wskazanego w E2E_DNS_TXT_FILE:
//   - plik nie istnieje  => "brak rekordu" (ENODATA), jak przy niewpisanym DNS,
//   - plik istnieje      => jego treść jest wartością rekordu TXT.
// Kod aplikacji nie zawiera żadnego hooka testowego - podmiana jest w skrypcie.
const fs = require('fs');
const dns = require('dns');

const file = process.env.E2E_DNS_TXT_FILE;
if (!file) {
  throw new Error('dns-stub: brak E2E_DNS_TXT_FILE');
}

dns.promises.Resolver.prototype.resolveTxt = async function resolveTxt() {
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' });
  }
  return [[fs.readFileSync(file, 'utf8').trim()]];
};
