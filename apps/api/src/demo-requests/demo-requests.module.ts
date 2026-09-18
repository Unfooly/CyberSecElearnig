import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { DemoRequestsController } from './demo-requests.controller';
import { DemoRequestsService } from './demo-requests.service';

@Module({
  imports: [EmailModule],
  controllers: [DemoRequestsController],
  providers: [DemoRequestsService],
})
export class DemoRequestsModule {}
