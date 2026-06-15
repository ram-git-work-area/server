import type { JwtTokenService } from '@roundz/auth';
import { validate } from '@roundz/validation';
import {
  loginResponseSchema,
  type LoginRequest,
  type LoginResponse,
} from '../schemas/login.schema';

export class AuthService {
  private readonly expiresInSeconds = 900;

  constructor(private readonly jwtTokenService: JwtTokenService) {}

  async login(input: LoginRequest): Promise<LoginResponse> {
    const accessToken = this.jwtTokenService.sign({
      sub: `placeholder-user:${input.email}`,
      role: 'customer',
    });

    return validate(loginResponseSchema, {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: this.expiresInSeconds,
    });
  }
}
