import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { JobsModule } from '../jobs/jobs.module';
import { DnsTxtResolver, NodeDnsTxtResolver } from './dns-txt-resolver';
import { DomainVerificationService } from './domain-verification.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { PendingOrganizationCleanupService } from './pending-organization-cleanup.service';

@Module({
  imports: [EmailModule, JobsModule],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    DomainVerificationService,
    PendingOrganizationCleanupService,
    // Abstrakcja pozwala w testach podmienić DNS (nigdy prawdziwe zapytania).
    { provide: DnsTxtResolver, useClass: NodeDnsTxtResolver },
  ],
  // PendingOrganizationCleanupService: natychmiastowe usunięcie organizacji PENDING przy przejęciu adresu jej jedynego admina.
  exports: [DomainVerificationService, PendingOrganizationCleanupService],
})
export class OrganizationsModule {}
