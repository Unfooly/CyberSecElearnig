import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DemoRequestsService } from './demo-requests.service';
import { CreateDemoRequestDto } from './dto/create-demo-request.dto';

// Endpoint publiczny (bez JWT) - stąd ciasny limit na IP (in-memory, jak
// reszta throttlera w projekcie).
@Controller('demo-requests')
export class DemoRequestsController {
  constructor(private readonly demoRequestsService: DemoRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  create(@Body() dto: CreateDemoRequestDto) {
    return this.demoRequestsService.create(dto);
  }
}
