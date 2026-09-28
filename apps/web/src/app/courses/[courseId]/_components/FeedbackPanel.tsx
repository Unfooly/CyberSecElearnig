import type { LastResult } from '@/lib/courses-types';

// Backend nie zwraca wyjaśnienia/uzasadnienia tekstowego dla odpowiedzi
// (CourseProgressResponseDto.lastResult ma tylko {blockIndex, type,
// correct}) - contentBlocks z /start ma już usunięty klucz odpowiedzi
// (correct/outcome/feedback), więc tu nie ma skąd wziąć wyjaśnienia. Stąd
// generyczny komunikat poprawnie/niepoprawnie. Komentarz do wyniku z treści
// (schemaVersion 4, reactions.result) - od D-093 (bez maskotki) zwykły tekst
// pod komunikatem; poza (`pose`) z API jest ignorowana. Bez własnego przycisku dalej - „Dalej” jest w dolnym pasku (D-106).
export default function FeedbackPanel({ feedback }: { feedback: LastResult }) {
  const isScoreable = feedback.correct !== undefined;

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      {isScoreable ? (
        <p
          className={`text-lg font-medium ${feedback.correct ? 'text-green-700' : 'text-red-700'}`}
        >
          {feedback.correct ? 'Poprawna odpowiedź!' : 'Niepoprawna odpowiedź.'}
        </p>
      ) : (
        <p className="text-lg font-medium text-slate-900">Blok ukończony.</p>
      )}
      {feedback.reaction?.text && (
        <p data-testid="feedback-reaction" className="mt-2 text-sm text-slate-700">
          {feedback.reaction.text}
        </p>
      )}
    </div>
  );
}
