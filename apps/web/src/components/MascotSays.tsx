import Mascot from './Mascot';

// Maskotka i jej dymek jako JEDNA jednostka: dymek ma "ogonek" wskazujący na maskotkę i jest wyrównany do jej głowy.
// Desktop: maskotka ok. 128 px po lewej; telefon (390 px): 76 px, dymek po prawej, ogonek w lewo. Tekst dymka (nawet 3-4 zdania) zawija się
// w dymku; bez tekstu pokazujemy samą maskotkę.
export default function MascotSays({ pose, text, className = '' }: { pose: string; text?: string; className?: string }) {
  return (
    <div className={`flex items-start gap-3 sm:gap-4 ${className}`} data-testid="mascot-says">
      <Mascot pose={pose} size={128} className="h-[76px] w-[76px] sm:h-32 sm:w-32" />
      {text && (
        <div className="relative mt-2 min-w-0 max-w-[62ch] rounded-xl bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-sm ring-1 ring-slate-200 sm:mt-5 sm:text-base">
          {/* Ogonek: obrócony kwadrat z obramowaniem tylko od strony maskotki, na wysokości jej głowy. */}
          <span
            aria-hidden="true"
            className="absolute -left-[7px] top-5 h-3.5 w-3.5 rotate-45 border-b border-l border-slate-200 bg-white sm:top-6"
          />
          <p>{text}</p>
        </div>
      )}
    </div>
  );
}
