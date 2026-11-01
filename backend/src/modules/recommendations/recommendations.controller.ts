import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt.guard';
import { currentUser } from '../../common/helpers/request-user';
import { RecommendationsService } from './recommendations.service';

@Controller('recommendations')
export class RecommendationsController {
  constructor(private recommendationsService: RecommendationsService) {}

  /** Auth is optional — guests get the popular/new fallback. */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(@Req() req: Request) {
    return this.recommendationsService.forUser(currentUser(req)?.id ?? undefined);
  }
}
