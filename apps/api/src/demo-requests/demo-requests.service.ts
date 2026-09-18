import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { CreateDemoRequestDto } from './dto/create-demo-request.dto';

const SUCCESS_MESSAGE = 'Dziękujemy! Odpiszemy w ciągu 1 dnia roboczego.';

// Publiczny formularz "Umów demo" ze strony głównej. Nie dotyka danych
// klienckich ani bazy (brak organizationId) - to wyłącznie powiadomienie
// e-mail dla sprzedaży, chronione limitem żądań i pułapką na boty.
@Injectable()
export class DemoRequestsService {
  private readonly logger = new Logger(DemoRequestsService.name);
  private readonly salesEmail: string | undefined;

  constructor(
    configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    const raw = configService.get<string>('SALES_EMAIL')?.trim();
    this.salesEmail = raw ? raw : undefined;
  }

  async create(dto: CreateDemoRequestDto): Promise<{ message: string }> {
    if (dto.website) {
      return { message: SUCCESS_MESSAGE };
    }
    if (!this.salesEmail) {
      this.logger.error('SALES_EMAIL nie jest ustawiony - prośba o demo nie może zostać dostarczona.');
      throw new ServiceUnavailableException('Formularz jest chwilowo niedostępny. Napisz do nas bezpośrednio.');
    }

    const sent = await this.emailService.send({
      to: this.salesEmail,
      subject: `Nowa prośba o demo (${dto.employeeCount} os.)`,
      templateName: 'demo-request',
      templateData: { email: dto.email, employeeCount: dto.employeeCount },
    });
    if (!sent) {
      throw new ServiceUnavailableException('Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.');
    }
    return { message: SUCCESS_MESSAGE };
  }
}
