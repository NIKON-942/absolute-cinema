import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from '../devices/devices.module';
import { PaymentsModule } from '../payments/payments.module';
import { ActorEntity } from './entities/actor.entity';
import { CountryEntity } from './entities/country.entity';
import { DirectorEntity } from './entities/director.entity';
import { GenreEntity } from './entities/genre.entity';
import { MovieEntity } from './entities/movie.entity';
import { RatingEntity } from './entities/rating.entity';
import { WatchProgressEntity } from './entities/watch-progress.entity';
import { AdminMediaController } from './admin-media.controller';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { TranscodeService } from './transcode.service';

@Module({
  imports: [
    DevicesModule,
    PaymentsModule,
    TypeOrmModule.forFeature([
      MovieEntity,
      GenreEntity,
      ActorEntity,
      CountryEntity,
      DirectorEntity,
      RatingEntity,
      WatchProgressEntity,
    ]),
  ],
  controllers: [MediaController, AdminMediaController],
  providers: [MediaService, TranscodeService],
  exports: [MediaService],
})
export class MediaModule {}
