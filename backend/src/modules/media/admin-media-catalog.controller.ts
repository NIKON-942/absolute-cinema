import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MediaService } from './media.service';

class MovieVisibilityDto {
  @IsBoolean()
  isHidden!: boolean;
}

/** Explicit admin reads keep hidden movies out of every public catalog route. */
@Controller('admin/media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMediaCatalogController {
  constructor(private mediaService: MediaService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('visibility') visibility: 'all' | 'published' | 'hidden' = 'all',
  ) {
    if (!['all', 'published', 'hidden'].includes(visibility)) {
      throw new BadRequestException('visibility must be all, published or hidden');
    }
    return this.mediaService.listMovies({
      search,
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 20)),
    }, undefined, visibility);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.mediaService.getMovie(id, undefined, true);
  }

  @Patch(':id/visibility')
  setVisibility(@Param('id', ParseIntPipe) id: number, @Body() body: MovieVisibilityDto) {
    return this.mediaService.setVisibility(id, body.isHidden);
  }
}
