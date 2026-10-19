import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, StrategyOptions } from 'passport-google-oauth20';
import type { Env } from '../../config/env';

export interface GoogleUser {
  sub: string;
  email: string;
  emailVerified: boolean;
  nombre: string;
  avatarUrl: string | null;
  /** dominio de Google Workspace (vacío en cuentas @gmail.com) */
  hd: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    const options: StrategyOptions = {
      // si no hay credenciales, el guard responde 503 antes de llegar aquí
      clientID: config.get('GOOGLE_CLIENT_ID') || 'no-configurado',
      clientSecret: config.get('GOOGLE_CLIENT_SECRET') || 'no-configurado',
      callbackURL: config.get('GOOGLE_CALLBACK_URL'),
      scope: ['openid', 'email', 'profile'],
    };
    // @nestjs/passport 11 tipa el constructor con la última sobrecarga (con request); estas opciones son la otra
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(options as any);
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): GoogleUser {
    const json = profile._json as Record<string, any>;
    return {
      sub: profile.id,
      email: (profile.emails?.[0]?.value ?? json['email'] ?? '').toLowerCase(),
      emailVerified: json['email_verified'] === true || json['email_verified'] === 'true',
      nombre: profile.displayName ?? json['name'] ?? '',
      avatarUrl: profile.photos?.[0]?.value ?? null,
      hd: json['hd'] ?? null,
    };
  }
}
