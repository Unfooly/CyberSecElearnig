import { UserResponseDto } from './user-response.dto';

export class InviteUserResponseDto extends UserResponseDto {
  // false = konto utworzone, ale e-mail z zaproszeniem nie wyszedł (np.
  // odrzucony przez dostawcę) - UI ostrzega i oferuje ponowną wysyłkę.
  inviteEmailSent!: boolean;
}
