// Tylko znaki ASCII w adresie - dostawca e-mail (MailerSend/SMTP) odrzuca
// części lokalne ze znakami spoza ASCII (np. "poźniak@"), a zaproszenie
// wyglądałoby na udane, choć mail nigdy nie wyjdzie. Backend waliduje to samo
// (IsEmail z allow_utf8_local_part: false) - ta walidacja to tylko UX.
export const EMAIL_REGEX =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
