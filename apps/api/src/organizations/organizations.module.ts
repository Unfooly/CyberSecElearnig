import { Module } from '@nestjs/common';
import { DnsTxtResolver, NodeDnsTxtResolver } from './dns-txt-resolver';
import { DomainVerificationService } from './domain-verification.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    DomainVerificationService,
    // Abstrakcja pozwala w testach podmienić DNS (nigdy prawdziwe zapytania).
    { provide: DnsTxtResolver, useClass: NodeDnsTxtResolver },
  ],
  exports: [DomainVerificationService],
})
export class OrganizationsModule {}
