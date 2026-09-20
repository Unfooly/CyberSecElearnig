import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json, urlencoded } from 'express';

/** Limit ciała żądania (domyślny limit Express to 100 kB - ustawiamy go jawnie). */
export const BODY_LIMIT = '100kb';

// Błędy parsera ciała (body-parser / raw-body) mają pole `type` z tej rodziny.
const BODY_PARSER_ERROR_TYPE = /^(entity\.|charset\.|encoding\.|request\.)/;

interface BodyParserError {
  type: string;
  status?: number;
  statusCode?: number;
}

export function isBodyParserError(error: unknown): error is BodyParserError {
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' && BODY_PARSER_ERROR_TYPE.test(type);
}

/**
 * Middleware błędów parsera ciała: odpowiada STAŁYM komunikatem i nie loguje niczego. Domyślna obsługa zwraca w
 * odpowiedzi `error.message`, a ten pochodzi z JSON.parse i zawiera FRAGMENT ciała (np. `Unexpected token 'S',
 * "SEKRET..." is not valid JSON`) - a publiczny POST /t/:token/submit dostaje ciała, które mogą zawierać hasło wpisane
 * w symulowany formularz. Pozostałe błędy przechodzą dalej bez zmian.
 */
export function bodyParserErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction): void {
  if (!isBodyParserError(error)) {
    next(error);
    return;
  }
  const status = error.status ?? error.statusCode ?? 400;
  response.status(status).json({ statusCode: status, message: 'Nieprawidłowe żądanie.' });
}

/**
 * Parsowanie ciała ZAMIAST wbudowanego w Nest (aplikację trzeba utworzyć z `{ bodyParser: false }`): dzięki temu
 * middleware błędów stoi bezpośrednio za parserami i przechwytuje ich błędy, zanim trafią do domyślnej obsługi
 * (która ujawnia i loguje fragment ciała). Wołane z main.ts i z testów e2e ścieżek publicznych.
 * Uwaga dla przyszłego webhooka Stripe: będzie potrzebował surowego ciała (osobny parser `raw` na jego ścieżce).
 */
export function configureBodyParsing(app: INestApplication): void {
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(bodyParserErrorHandler);
}
