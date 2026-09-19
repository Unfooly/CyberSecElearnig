import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowPendingOrganization } from '../common/decorators/allow-pending-organization.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipSessionCheck } from '../common/decorators/skip-session-check.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';

// Ciaśniejszy limit niż globalny default (app.module.ts) — ochrona przed
// brute-force / credential stuffing na endpointach logowania i rejestracji.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

// Limity dla odświeżania i wylogowania: luźniejsze niż logowanie (legalnie częstsze, a limit jest per IP
// klienta - patrz TRUST_PROXY), ale nie bez granic (każde odświeżenie to kilka zapytań do bazy).
const SESSION_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

// Uwierzytelnianie (logowanie, odświeżanie, reset hasła, weryfikacja) musi działać
// także dla organizacji czekającej na weryfikację domeny. To trasy publiczne: stary,
// unieważniony Bearer nie może ich blokować (@SkipSessionCheck); wyjątek: logout-all.
@Controller('auth')
@AllowPendingOrganization()
@SkipSessionCheck()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
  ) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  register(@Body() dto: RegisterDto) {
    return this.registrationService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(SESSION_THROTTLE)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Wylogowanie bieżącej sesji: poświadczeniem jest sam refresh token (unieważnia jego rodzinę).
  // Zawsze 200 - także dla nieznanego/wygasłego tokenu (idempotentne, bez wyroczni). Access
  // token wydany wcześniej działa jeszcze do wygaśnięcia (max 15 min) - dla natychmiastowego
  // unieważnienia jest /auth/logout-all.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle(SESSION_THROTTLE)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }

  // "Wyloguj wszędzie": unieważnia wszystkie sesje bieżącego użytkownika, access tokeny wydane
  // wcześniej przestają działać natychmiast (guard + Redis). Wymaga ważnego JWT; userId z tokenu.
  @Post('logout-all')
  @SkipSessionCheck(false)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(SESSION_THROTTLE)
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logoutAll(user.organizationId, user.userId);
    return { success: true };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }
}
