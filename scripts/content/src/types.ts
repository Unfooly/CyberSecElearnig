// Interfejsy granic zewnętrznych. Cała sieć (ElevenLabs, S3/R2) siedzi ZA nimi, więc testy i CI używają fake'ów i nie wykonują żadnych
// wywołań sieciowych (D-060). Implementacje: providers/elevenlabs.ts, stores/{local,r2}.ts (kolejne commity).

/** Czasy znaków z ElevenLabs (`alignment` z odpowiedzi with-timestamps): znak i moment jego początku/końca w nagraniu (sekundy). */
export interface Alignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

export interface SynthesisRequest {
  text: string;
  voiceId: string;
  model: string;
  language: string;
}

export interface SynthesisResult {
  /** Nagranie mp3. */
  audio: Uint8Array;
  alignment: Alignment;
}

export interface TtsProvider {
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
}

export interface PutOptions {
  contentType: string;
  cacheControl: string;
}

export interface ObjectHead {
  size: number;
  /** Skrót MD5 zawartości (ETag jednoczęściowego zapisu) do pomijania niezmienionych plików; null, gdy magazyn go nie zna. */
  md5: string | null;
}

/** Magazyn obiektów (lokalny katalog albo bucket R2). Klucze to ścieżki względne bazy zasobów (np. `audio/<slug>/v1/<blok>/<hash>.mp3`). */
export interface ObjectStore {
  /** Metadane obiektu albo null, gdy go nie ma (HEAD). */
  head(key: string): Promise<ObjectHead | null>;
  get(key: string): Promise<Uint8Array | null>;
  /** Zapis. Nie nadpisuje istniejącego obiektu, chyba że `overwrite`; zwraca false, gdy obiekt już był (nic nie zapisano). */
  put(key: string, body: Uint8Array, options: PutOptions, overwrite?: boolean): Promise<boolean>;
}

/** Narracja gotowa do zapisu w module: wszystko, co skrypt TTS wpisuje do `narration`. */
export interface GeneratedNarration {
  audioUrl: string;
  durationMs: number;
  cues: { text: string; startMs: number }[];
}
