// Ekran startu (D-163) i ekran końca (D-165) modułu - wspólne kroki ręcznych skryptów e2e modułów (scripts/e2e-module-0N.mjs, B-164).
// Z danymi modułu (`moduleInfo`, zawsze na produkcji) odtwarzacz pokazuje przed pierwszym blokiem ekran startu, a po ostatnim zapisie -
// ekran końca; blok SUMMARY nie ma własnego ekranu - odtwarzacz zapisuje go sam (D-169).

/**
 * Ekran startu: tytuł modułu, numer sprawy (gdy moduł go ma), opcjonalna uwaga w czerwonej ramce (D-171), potem „Start”.
 * `step(name, ok, detail)` - funkcja kroku skryptu (wywala przebieg przy porażce).
 */
export async function passStartScreen(page, step, { title, caseNumber, notice }) {
  const start = page.getByTestId('module-start');
  await start.waitFor();
  const kicker = caseNumber ? (await start.getByText(new RegExp(`Sprawa ${caseNumber}\\b`)).count()) >= 1 : true;
  const noticeBox = page.getByTestId('module-start-notice');
  const noticeOk = notice ? (await noticeBox.count()) === 1 && ((await noticeBox.textContent()) ?? '').includes(notice) : (await noticeBox.count()) === 0;
  step(
    `Start: tytuł „${title}”${caseNumber ? `, „Sprawa ${caseNumber}”` : ''}${notice ? ', uwaga w ramce' : ''}`,
    (await start.getByRole('heading', { level: 1, name: title, exact: true }).count()) === 1 && kicker && noticeOk,
  );
  await start.getByRole('button', { name: 'Start', exact: true }).click();
  await start.waitFor({ state: 'detached' });
  await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
  step('Start: po „Start” odtwarzacz z pierwszym blokiem', true);
}

/** Odpowiedź POST /progress, która kończy kurs (status COMPLETED) - utwórz PRZED kliknięciem, które ją wywoła. */
// Obietnica ma od razu obsługę odrzucenia: gdy krok przed `await` się wywali, `finally` zamyka przeglądarkę, a nieobsłużone odrzucenie
// („Target closed”) zabiłoby proces przed sprzątaniem bazy i zabiciem serwerów. `await` w skrypcie dalej zgłasza błąd normalnie.
export function completionResponse(page, courseId, timeout = 30000) {
  const response = page.waitForResponse(
    async (r) =>
      r.url().includes(`/api/courses/${courseId}/progress`) &&
      r.request().method() === 'POST' &&
      (await r.json().catch(() => ({}))).status === 'COMPLETED',
    { timeout },
  );
  response.catch(() => {});
  return response;
}

/**
 * Ekran końca po ukończeniu: pieczątka, kafelki Wynik / Czas / Punkty, poziom z nowymi osiągnięciami, zasady na wynos, przyciski.
 * `completion` - treść odpowiedzi z completionResponse (wynik i nagroda z serwera), `rules` - oczekiwane zasady (pełne zdania) albo null.
 */
export async function checkEndScreen(page, step, { completion, rules }) {
  const end = page.getByTestId('module-end');
  await end.waitFor({ timeout: 20000 });
  const tile = async (name) => ((await page.getByTestId(`module-end-${name}`).textContent()) ?? '').trim();
  step(
    'KONIEC: pieczątka „Sprawa zamknięta”, bez ekranu podsumowania (D-169)',
    ((await page.getByTestId('module-end-stamp').textContent()) ?? '').includes('Sprawa zamknięta') && (await page.getByTestId('player-content-area').count()) === 0,
  );
  step(
    `KONIEC: kafelki - wynik ${completion.score}% z serwera, czas w minutach, +XP`,
    (await tile('wynik')) === `${completion.score}%` && /^\d+ min$/.test(await tile('czas')) && /^\+[1-9]\d*$/.test(await tile('punkty')),
    `${await tile('wynik')} | ${await tile('czas')} | ${await tile('punkty')}`,
  );
  const reward = completion.gamification;
  if (reward) {
    const level = reward.leveledUp ? reward.newLevel : reward.previousLevel;
    const titles = (reward.unlockedBadges ?? []).map((badge) => badge.title).filter(Boolean);
    const badgeText = (await page.getByTestId('module-end-badge').count()) > 0 ? ((await page.getByTestId('module-end-badge').textContent()) ?? '') : '';
    step(
      `KONIEC: pasek „Poziom ${level}”${titles.length ? ` i nowe osiągnięcia (${titles.join(', ')})` : ''}`,
      (await page.getByTestId('module-end-level').getByRole('progressbar', { name: `Poziom ${level}`, exact: true }).count()) === 1 && titles.every((title) => badgeText.includes(title)),
      badgeText,
    );
  }
  if (rules) {
    const shown = (await end.getByRole('region', { name: /zasady na wynos/i }).getByRole('listitem').allTextContents()).map((line) => line.replace(/^\d+\.\s*/, '').trim());
    step('KONIEC: zasady na wynos z treści modułu', JSON.stringify(shown) === JSON.stringify(rules), shown.join(' | '));
  }
  step(
    'KONIEC: „Wróć do biblioteki” (link do /courses) i „Zagraj jeszcze raz”',
    (await end.getByRole('link', { name: 'Wróć do biblioteki' }).getAttribute('href')) === '/courses' && (await end.getByRole('button', { name: 'Zagraj jeszcze raz' }).count()) === 1,
  );
}
