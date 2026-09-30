// globalSetup testów e2e API (B-141): testy tworzą i kasują organizacje, użytkowników i kursy oraz piszą do Redisa, więc startują
// wyłącznie na lokalnej bazie i lokalnym Redisie albo w kontenerach testowych CI - ta sama blokada co w skryptach e2e
// (scripts/lib/local-db-guard.mjs, test: scripts/content/src/local-db-guard.test.ts). Bez flagi wyłączającej.
// Plik .cjs: Jest ładuje go przez require, bez transformacji ts-jest - dynamiczny import modułu ESM działa natywnie.
module.exports = async function globalSetup() {
  const { databaseProblems, refusalMessage } = await import('../../../scripts/lib/local-db-guard.mjs');
  const problems = databaseProblems(process.env);
  if (problems.length > 0) throw new Error(refusalMessage('npm run test:e2e (apps/api)', problems));
};
