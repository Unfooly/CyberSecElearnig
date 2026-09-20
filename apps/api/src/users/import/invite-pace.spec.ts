import { dailyRemaining, estimateInviteCompletion, INVITE_DAILY_LIMIT_PER_ORG, INVITE_PER_RUN, inviteCapacity } from './invite-pace';

const NOW = new Date('2027-03-01T10:00:00Z');
const DAY = 24 * 3_600_000;

describe('inviteCapacity', () => {
  it('nie więcej niż tempo jednego biegu, nawet gdy limit dobowy jest daleko', () => {
    expect(inviteCapacity(300, 0, 0)).toBe(INVITE_PER_RUN);
  });

  it('kończy się limitem dobowym: reszta okna kroczącego pomniejszona o zaproszenia już zajęte do wysyłki', () => {
    expect(inviteCapacity(300, 290, 0)).toBe(10);
    expect(inviteCapacity(300, 290, 4)).toBe(6);
    expect(inviteCapacity(300, 300, 0)).toBe(0);
  });

  it('nigdy nie zwraca wartości ujemnej (tokeny ręczne przekroczyły limit)', () => {
    expect(inviteCapacity(300, 340, 0)).toBe(0);
    expect(inviteCapacity(300, 290, 30)).toBe(0);
  });

  it('TEMPO niezależne od liczby biegów: zaproszenia zajęte w oknie biegu pomniejszają jego pojemność', () => {
    expect(inviteCapacity(300, 0, 0, 0)).toBe(20);
    expect(inviteCapacity(300, 0, 0, 12)).toBe(8);
    expect(inviteCapacity(300, 0, 0, 20)).toBe(0);
    expect(inviteCapacity(300, 0, 0, 35)).toBe(0); // więcej niż tempo: nigdy ujemne
  });

  it('limit dobowy i tempo działają razem: wygrywa mniejsza pojemność', () => {
    expect(inviteCapacity(300, 295, 0, 0)).toBe(5); // dobowy mniejszy niż tempo
    expect(inviteCapacity(300, 0, 0, 15)).toBe(5); // tempo mniejsze niż dobowy
    expect(inviteCapacity(300, 295, 0, 18)).toBe(2);
  });
});

describe('dailyRemaining', () => {
  it('to reszta dobowego limitu, nie mniej niż 0', () => {
    expect(dailyRemaining(300, 120)).toBe(180);
    expect(dailyRemaining(300, 500)).toBe(0);
  });
});

describe('estimateInviteCompletion', () => {
  it('nie ma czego wysyłać: null', () => {
    expect(estimateInviteCompletion(0, 300, NOW)).toBeNull();
  });

  it('mieści się w dzisiejszym limicie: czas biegów (20 na 5 minut)', () => {
    expect(estimateInviteCompletion(20, 300, NOW)).toEqual(new Date(NOW.getTime() + 5 * 60_000));
    expect(estimateInviteCompletion(21, 300, NOW)).toEqual(new Date(NOW.getTime() + 10 * 60_000));
    expect(estimateInviteCompletion(300, 300, NOW)).toEqual(new Date(NOW.getTime() + 15 * 5 * 60_000));
  });

  it('import 5000 osób: rozkłada się na kolejne doby w ramach 300/dobę (dziś 300, potem 16 pełnych dób)', () => {
    const eta = estimateInviteCompletion(5000, 300, NOW) as Date;

    // 5000 - 300 dziś = 4700 => ceil(4700 / 300) = 16 dób.
    expect(eta.getTime() - NOW.getTime()).toBe(16 * DAY);
  });

  it('dzisiejszy limit prawie wyczerpany: większość czeka na kolejną dobę', () => {
    const eta = estimateInviteCompletion(100, 10, NOW) as Date;

    expect(eta.getTime() - NOW.getTime()).toBe(DAY); // 90 czeka: ceil(90 / 300) = 1 doba
  });

  it('limit wyczerpany dziś (0): pierwsza porcja dopiero jutro', () => {
    const eta = estimateInviteCompletion(50, 0, NOW) as Date;

    expect(eta.getTime() - NOW.getTime()).toBe(DAY);
  });

  it('dobowy limit stały: 300', () => {
    expect(INVITE_DAILY_LIMIT_PER_ORG).toBe(300);
  });
});
