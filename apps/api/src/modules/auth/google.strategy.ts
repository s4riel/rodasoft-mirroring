import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, StrategyOptions } from 'passport-google-oauth20';
import type { Env } from '../../config/env';

export interface GoogleUser {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
  /** Google Workspace domain (empty for @gmail.com accounts) */
  hd: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    const options: StrategyOptions = {
      // without credentials, the guard answers 503 before getting here
      clientID: config.get('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret: config.get('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL: config.get('GOOGLE_CALLBACK_URL'),
      scope: ['openid', 'email', 'profile'],
    };
    // @nestjs/passport 11 types the constructor with the last overload (with request); these options are the other one
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(options as any);
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): GoogleUser {
    const json = profile._json as Record<string, any>;
    return {
      sub: profile.id,
      email: (profile.emails?.[0]?.value ?? json['email'] ?? '').toLowerCase(),
      emailVerified: json['email_verified'] === true || json['email_verified'] === 'true',
      name: profile.displayName ?? json['name'] ?? '',
      avatarUrl: profile.photos?.[0]?.value ?? null,
      hd: json['hd'] ?? null,
    };
  }
}
