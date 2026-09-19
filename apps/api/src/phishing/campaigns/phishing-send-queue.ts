import { Injectable } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service';

/** Nazwa zadania BullMQ: wysyłka JEDNEGO maila kampanii. */
export const SEND_TASK_NAME = 'phishing-send';

export interface SendTaskData {
  organizationId: string;
  recipientId: string;
}

// BullMQ nie dopuszcza ":" w własnych identyfikatorach zadań.
export const sendJobId = (recipientId: string) => `phishing-send_${recipientId}`;

export interface SendQueueItem extends SendTaskData {
  /** Opóźnienie do zaplanowanego momentu wysyłki (ms). */
  delayMs: number;
}

export interface EnqueueMode {
  /**
   * Zadanie uzgadniające: zakończone/nieudane zadanie tego odbiorcy (zostaje w Redisie) jest usuwane przed
   * ponownym dodaniem - inaczej deduplikacja po id po cichu zignorowałaby próbę odtworzenia.
   */
  replaceFinished?: boolean;
}

/**
 * Port kolejki wysyłki (BullMQ w produkcji, atrapa w testach - test nie czeka na realne opóźnienia).
 * Zadania są deduplikowane po id odbiorcy: ponowne dodanie (np. przez zadanie uzgadniające) jest ignorowane.
 */
export abstract class PhishingSendQueue {
  abstract enqueue(items: SendQueueItem[], mode?: EnqueueMode): Promise<void>;
  abstract remove(recipientIds: string[]): Promise<void>;
}

const BULK_CHUNK = 500;

@Injectable()
export class BullPhishingSendQueue extends PhishingSendQueue {
  constructor(private readonly jobs: JobsService) {
    super();
  }

  async enqueue(items: SendQueueItem[], mode: EnqueueMode = {}): Promise<void> {
    const data = (item: SendQueueItem): SendTaskData => ({ organizationId: item.organizationId, recipientId: item.recipientId });
    if (mode.replaceFinished) {
      for (const item of items) {
        await this.jobs.enqueueDelayed(SEND_TASK_NAME, data(item), { delayMs: item.delayMs, jobId: sendJobId(item.recipientId), replaceFinished: true });
      }
      return;
    }
    for (let start = 0; start < items.length; start += BULK_CHUNK) {
      await this.jobs.enqueueDelayedBulk(
        SEND_TASK_NAME,
        items.slice(start, start + BULK_CHUNK).map((item) => ({ data: data(item), options: { delayMs: item.delayMs, jobId: sendJobId(item.recipientId) } })),
      );
    }
  }

  async remove(recipientIds: string[]): Promise<void> {
    await this.jobs.removeQueued(recipientIds.map(sendJobId));
  }
}
