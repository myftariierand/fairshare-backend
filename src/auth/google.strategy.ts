import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, StrategyOptions } from 'passport-google-oauth20';
import { UsersService } from 'src/users/users.service';
import { OAuthCookieStateStore } from './oauth-state.store';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly usersService: UsersService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      callbackURL: process.env.GOOGLE_CALLBACK_URL as string,
      scope: ['email', 'profile'],
      // The types only describe a store that takes metadata, but passport also accepts this shape
      store: new OAuthCookieStateStore() as unknown as StrategyOptions['store'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
  ): Promise<any> {
    const email = profile.emails?.[0];

    // Some Google endpoints send this flag as a string
    if (!email?.value || String(email.verified) !== 'true') {
      throw new UnauthorizedException('Google account not verified');
    }

    return this.usersService.findOrCreateGoogleUser(
      email.value,
      profile.displayName,
    );
  }
}
