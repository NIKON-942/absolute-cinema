import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  HttpException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  Body,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { basename } from 'path';
import { existsSync } from 'fs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { currentUser, currentUserId } from '../../common/helpers/request-user';
import { DevicesService } from '../devices/devices.service';
import { QUALITY_RANK, PlanLimitsService } from '../payments/plan-limits.service';
import { SubscriptionTierEnum } from '../users/user.entity';
import { POSTERS_DIR } from './media.constants';
import { MediaService } from './media.service';
import { VideoQuality } from './entities/movie.entity';

@Controller('media')
export class MediaController {
  constructor(
    private mediaService: MediaService,
    private devicesService: DevicesService,
    private planLimits: PlanLimitsService,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('genre') genre?: string,
    @Query('year') year?: string,
    @Query('yearFrom') yearFrom?: string,
    @Query('yearTo') yearTo?: string,
    @Query('country') country?: string,
    @Query('ageRating') ageRating?: string,
    @Query('sort') sort?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.mediaService.listMovies({
      search,
      genre,
      year,
      yearFrom,
      yearTo,
      country,
      ageRating,
      sort,
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 20)),
    }, currentUser(req)?.id);
  }

  @Get('genres')
  genres() {
    return this.mediaService.genres();
  }

  @Get('actors')
  actors() {
    return this.mediaService.actors();
  }

  @Get('countries')
  countries() {
    return this.mediaService.countries();
  }

  @Get('directors')
  directors() {
    return this.mediaService.directors();
  }

  @Get('favorites')
  @UseGuards(JwtAuthGuard)
  favorites(@Req() req: Request) {
    return this.mediaService.favorites(currentUserId(req));
  }

  @Get('progress')
  @UseGuards(JwtAuthGuard)
  progress(@Req() req: Request) {
    return this.mediaService.listProgress(currentUserId(req));
  }

  @Get('posters/:filename')
  poster(@Param('filename') filename: string, @Res() res: Response) {
    const safe = basename(filename); // prevent path traversal
    const filePath = `${POSTERS_DIR}/${safe}`;
    if (!existsSync(filePath)) {
      res.status(404).json({
        statusCode: 404,
        message: 'Poster not found',
        error: 'Not Found',
      });
      return;
    }
    res.sendFile(filePath);
  }

  @Post(':id/favorites')
  @UseGuards(JwtAuthGuard)
  toggleFavorite(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.mediaService.toggleFavorite(id, currentUserId(req));
  }

  @Put(':id/rating')
  @UseGuards(JwtAuthGuard)
  rate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Body() body: { value: number },
  ) {
    const v = Number(body?.value);
    if (!Number.isFinite(v) || v < 1 || v > 10) {
      throw new BadRequestException('Rating must be an integer between 1 and 10');
    }
    return this.mediaService.setRating(id, currentUserId(req), Math.round(v));
  }

  @Delete(':id/rating')
  @UseGuards(JwtAuthGuard)
  unrate(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.mediaService.deleteRating(id, currentUserId(req));
  }

  @Put(':id/progress')
  @UseGuards(JwtAuthGuard)
  saveProgress(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Body() body: { positionSeconds: number; durationSeconds: number },
  ) {
    return this.mediaService.saveProgress(
      id,
      currentUserId(req),
      Number(body?.positionSeconds) || 0,
      Number(body?.durationSeconds) || 0,
    );
  }

  @Get(':id/stream')
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  async stream(
    @Param('id', ParseIntPipe) id: number,
    @Query('quality') quality = '720p',
    @Query('deviceId') deviceId: string | undefined,
    @Headers('range') range: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const maxQuality = await this.enforceStreamLimits(req, quality, deviceId);
    const movie = await this.mediaService.getMovieEntity(id);
    this.mediaService.stream(
      movie,
      validQuality(quality),
      range,
      req,
      res,
      maxQuality,
    );
  }

  @Head(':id/stream')
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  async headStream(
    @Param('id', ParseIntPipe) id: number,
    @Query('quality') quality = '720p',
    @Query('deviceId') deviceId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const maxQuality = await this.enforceStreamLimits(req, quality, deviceId);
    const movie = await this.mediaService.getMovieEntity(id);
    this.mediaService.headStream(movie, validQuality(quality), res, maxQuality);
  }

  /**
   * Plan enforcement shared by both stream verbs: rejects qualities above
   * the subscription cap with 402 UPGRADE_REQUIRED (the client turns this
   * into an upgrade prompt) and heartbeats the calling device so the
   * concurrent-device limit is enforced on the data path itself (409
   * DEVICE_LIMIT when exceeded). Returns the plan's max quality so the
   * "best ready rendition" fallback never serves above the cap.
   */
  private async enforceStreamLimits(
    req: Request,
    quality: string,
    deviceId: string | undefined,
  ): Promise<VideoQuality> {
    // Never collapse anonymous callers into one shared 'unknown' slot —
    // that would let a single client evict everyone else's heartbeats.
    if (!deviceId) {
      throw new BadRequestException('deviceId query parameter is required');
    }
    const tier =
      ((req.user as { activeSubscription?: { tier?: SubscriptionTierEnum } })
        .activeSubscription?.tier ?? SubscriptionTierEnum.BASIC);
    const limits = await this.planLimits.limitsFor(tier);

    const requested = validQuality(quality);
    if (QUALITY_RANK[requested] > QUALITY_RANK[limits.maxQuality]) {
      throw new HttpException(
        {
          statusCode: 402,
          code: 'UPGRADE_REQUIRED',
          message:
            `Your plan includes up to ${limits.maxQuality} video quality. ` +
            `Upgrade your subscription to watch in ${requested}.`,
          requestedQuality: requested,
          maxQuality: limits.maxQuality,
        },
        402,
      );
    }

    await this.devicesService.heartbeatThrottled(
      currentUserId(req),
      deviceId,
      req.headers['user-agent'],
    );
    return limits.maxQuality;
  }

  @Get(':id/similar')
  @UseGuards(OptionalJwtAuthGuard)
  similar(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.mediaService.similar(id, currentUser(req)?.id ?? undefined);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  detail(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.mediaService.getMovie(id, currentUser(req)?.id ?? undefined);
  }
}

function validQuality(q: string): '480p' | '720p' | '1080p' {
  if (q === '480p' || q === '1080p') return q;
  return '720p';
}
