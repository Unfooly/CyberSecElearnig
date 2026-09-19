import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhishingTemplate } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CloneTemplateDto, PreviewTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { hasTrackingLink, sanitizeLessonHtml, sanitizeTemplateBody } from './template-sanitizer';

/** Maksymalna liczba własnych szablonów organizacji (ochrona przed zaśmiecaniem bazy). */
export const MAX_ORGANIZATION_TEMPLATES = 100;

export const GLOBAL_TEMPLATE_READONLY = {
  code: 'GLOBAL_TEMPLATE_READONLY',
  message: 'Szablonu globalnego nie można edytować ani usuwać - sklonuj go do swojej organizacji.',
};
export const TEMPLATE_MISSING_TRACKING_LINK = {
  code: 'TEMPLATE_MISSING_TRACKING_LINK',
  message: 'Treść maila musi zawierać link {{trackingLink}} (jedyny dozwolony link). Inne linki są usuwane.',
};

export interface TemplateView {
  id: string;
  scope: 'GLOBAL' | 'ORGANIZATION';
  key: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
  lessonHtml: string;
  senderName: string;
  senderLocalPart: string;
  // Pełny adres nadawcy: część lokalna @ nasza domena (PHISHING_EMAIL_DOMAIN); null, gdy domena nieskonfigurowana.
  senderAddress: string | null;
  sourceTemplateId: string | null;
  updatedAt: Date;
}

export interface TemplateEditView {
  id: string;
  templateId: string | null;
  templateName: string;
  action: 'CLONED' | 'UPDATED' | 'DELETED';
  changedFields: string[];
  actorEmail: string;
  createdAt: Date;
}

const EDITABLE_FIELDS = ['name', 'subject', 'senderName', 'senderLocalPart', 'bodyHtml', 'lessonHtml'] as const;

/**
 * Szablony symulacji: globalne (organizationId NULL, tylko do odczytu) i własne organizacji
 * (klon + edycja). Każde zapytanie ma jawny warunek organizacji, a RLS (polityki per komenda)
 * jest drugą linią obrony - globalnego szablonu nie da się zmienić ani usunąć przez rolę aplikacji.
 * Treść jest sanityzowana ZAWSZE po stronie serwera (allow-lista tagów, jedyny link = placeholder).
 */
@Injectable()
export class PhishingTemplatesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly configService: ConfigService,
  ) {}

  private senderDomain(): string | null {
    const domain = this.configService.get<string>('PHISHING_EMAIL_DOMAIN')?.trim().toLowerCase();
    return domain ? domain : null;
  }

  private toView(template: PhishingTemplate): TemplateView {
    const domain = this.senderDomain();
    return {
      id: template.id,
      scope: template.organizationId === null ? 'GLOBAL' : 'ORGANIZATION',
      key: template.key,
      name: template.name,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      lessonHtml: template.lessonHtml,
      senderName: template.senderName,
      senderLocalPart: template.senderLocalPart,
      senderAddress: domain ? `${template.senderLocalPart}@${domain}` : null,
      sourceTemplateId: template.sourceTemplateId,
      updatedAt: template.updatedAt,
    };
  }

  /** Globalne i własne szablony organizacji (globalne pierwsze). */
  async list(organizationId: string): Promise<TemplateView[]> {
    const templates = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingTemplate.findMany({
        where: { OR: [{ organizationId: null }, { organizationId }] },
        orderBy: [{ organizationId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
      }),
    );
    return templates.map((template) => this.toView(template));
  }

  async get(organizationId: string, id: string): Promise<TemplateView> {
    return this.toView(await this.findVisible(organizationId, id));
  }

  private async findVisible(organizationId: string, id: string): Promise<PhishingTemplate> {
    const template = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingTemplate.findFirst({ where: { id, OR: [{ organizationId: null }, { organizationId }] } }),
    );
    if (!template) {
      throw new NotFoundException('Nie znaleziono szablonu.');
    }
    return template;
  }

  /** Klon szablonu (globalnego albo własnego) do organizacji. */
  async clone(organizationId: string, actor: AuthenticatedUser, id: string, dto: CloneTemplateDto): Promise<TemplateView> {
    const source = await this.findVisible(organizationId, id);
    const name = (dto.name ?? `${source.name} (kopia)`).slice(0, 120);

    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const count = await tx.phishingTemplate.count({ where: { organizationId } });
      if (count >= MAX_ORGANIZATION_TEMPLATES) {
        throw new ConflictException({
          code: 'TEMPLATE_LIMIT_REACHED',
          message: `Osiągnięto limit ${MAX_ORGANIZATION_TEMPLATES} własnych szablonów.`,
        });
      }
      const created = await tx.phishingTemplate.create({
        data: {
          organizationId,
          name,
          subject: source.subject,
          // Defense in depth: kopia przechodzi przez sanitizer także przy klonowaniu (szablony globalne z migracji).
          bodyHtml: sanitizeTemplateBody(source.bodyHtml),
          lessonHtml: sanitizeLessonHtml(source.lessonHtml),
          senderName: source.senderName,
          senderLocalPart: source.senderLocalPart,
          sourceTemplateId: source.id,
        },
      });
      await tx.phishingTemplateEdit.create({
        data: {
          organizationId,
          templateId: created.id,
          templateName: created.name,
          action: 'CLONED',
          changedFields: [],
          actorUserId: actor.userId,
          actorEmail: actor.email,
        },
      });
      return this.toView(created);
    });
  }

  /** Edycja własnego szablonu. Globalny: 403. Treść sanityzowana; zmiana audytowana (kto, kiedy, jakie pola). */
  async update(organizationId: string, actor: AuthenticatedUser, id: string, dto: UpdateTemplateDto): Promise<TemplateView> {
    const existing = await this.findOwn(organizationId, id);

    const next: Partial<Pick<PhishingTemplate, (typeof EDITABLE_FIELDS)[number]>> = {};
    if (dto.name !== undefined) next.name = dto.name;
    if (dto.subject !== undefined) next.subject = dto.subject;
    if (dto.senderName !== undefined) next.senderName = dto.senderName;
    if (dto.senderLocalPart !== undefined) next.senderLocalPart = dto.senderLocalPart;
    if (dto.bodyHtml !== undefined) {
      next.bodyHtml = sanitizeTemplateBody(dto.bodyHtml);
      if (!hasTrackingLink(next.bodyHtml)) {
        throw new BadRequestException(TEMPLATE_MISSING_TRACKING_LINK);
      }
    }
    if (dto.lessonHtml !== undefined) next.lessonHtml = sanitizeLessonHtml(dto.lessonHtml);

    const changedFields = EDITABLE_FIELDS.filter((field) => next[field] !== undefined && next[field] !== existing[field]);
    if (changedFields.length === 0) {
      return this.toView(existing);
    }

    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Jawny warunek organizacji (a RLS UPDATE i tak dopuszcza wyłącznie własne wiersze).
      const result = await tx.phishingTemplate.updateMany({ where: { id, organizationId }, data: next });
      if (result.count === 0) {
        throw new NotFoundException('Nie znaleziono szablonu.');
      }
      const updated = await tx.phishingTemplate.findFirstOrThrow({ where: { id, organizationId } });
      await tx.phishingTemplateEdit.create({
        data: {
          organizationId,
          templateId: id,
          templateName: updated.name,
          action: 'UPDATED',
          changedFields: [...changedFields],
          actorUserId: actor.userId,
          actorEmail: actor.email,
        },
      });
      return this.toView(updated);
    });
  }

  async remove(organizationId: string, actor: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findOwn(organizationId, id);

    await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const result = await tx.phishingTemplate.deleteMany({ where: { id, organizationId } });
      if (result.count === 0) {
        throw new NotFoundException('Nie znaleziono szablonu.');
      }
      // templateId zostaje zerowany przez FK (ON DELETE SET NULL) - nazwa jest kopią z chwili zdarzenia.
      await tx.phishingTemplateEdit.create({
        data: {
          organizationId,
          templateId: null,
          templateName: existing.name,
          action: 'DELETED',
          changedFields: [],
          actorUserId: actor.userId,
          actorEmail: actor.email,
        },
      });
    });
  }

  /** Własny szablon organizacji; szablon globalny to 403 (nie 404 - istnieje, ale jest tylko do odczytu). */
  private async findOwn(organizationId: string, id: string): Promise<PhishingTemplate> {
    const template = await this.findVisible(organizationId, id);
    if (template.organizationId === null) {
      throw new ForbiddenException(GLOBAL_TEMPLATE_READONLY);
    }
    return template;
  }

  /** Podgląd sanityzacji (nic nie zapisuje): co zostanie z treści po zapisie. */
  preview(dto: PreviewTemplateDto): { bodyHtml: string | null; lessonHtml: string | null; hasTrackingLink: boolean } {
    const bodyHtml = dto.bodyHtml === undefined ? null : sanitizeTemplateBody(dto.bodyHtml);
    return {
      bodyHtml,
      lessonHtml: dto.lessonHtml === undefined ? null : sanitizeLessonHtml(dto.lessonHtml),
      hasTrackingLink: bodyHtml === null ? false : hasTrackingLink(bodyHtml),
    };
  }

  /** Historia zmian (audyt) - własne szablony organizacji; opcjonalnie jednego szablonu. */
  async listEdits(organizationId: string, templateId?: string): Promise<TemplateEditView[]> {
    const edits = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingTemplateEdit.findMany({
        where: { organizationId, ...(templateId ? { templateId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    return edits.map((edit) => ({
      id: edit.id,
      templateId: edit.templateId,
      templateName: edit.templateName,
      action: edit.action,
      changedFields: edit.changedFields,
      actorEmail: edit.actorEmail,
      createdAt: edit.createdAt,
    }));
  }
}
