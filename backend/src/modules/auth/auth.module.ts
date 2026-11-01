import { Module } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadEnv } from 'dotenv';
import { AppConfig } from '../../config/configuration';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Needed before module decorators evaluate: GoogleStrategy registration
// depends on env that @nestjs/config has not loaded yet at import time.
loadEnv({ path: '.env' });
loadEnv({ path: '../.env' });
import { UserEntity } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([UserEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwt', { infer: true })!.secret,
        signOptions: {
          // jsonwebtoken validates the environment-provided duration at signing time.
          expiresIn: config.get('jwt', { infer: true })!.expiresIn as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // GoogleStrategy throws at construction without credentials, so it is
    // registered only when OAuth is actually configured.
    ...(process.env.GOOGLE_CLIENT_ID ? [GoogleStrategy] : []),
  ],
  exports: [AuthService],
})
export class AuthModule {}
