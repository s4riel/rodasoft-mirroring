import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env';

/** Access token payload. */
export interface JwtUser {
  /** user id */
  sub: string;
  /** company id */
  cid: string;
  /** membership id */
  mid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
      issuer: 'rodasoft',
      audience: 'rodasoft-erp',
    });
  }

  validate(payload: JwtUser): JwtUser {
    return { sub: payload.sub, cid: payload.cid, mid: payload.mid };
  }
}
