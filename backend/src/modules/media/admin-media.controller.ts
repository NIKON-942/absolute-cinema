import {
  BadRequestException,
  Get,
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
  Post,

  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'fs';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { POSTERS_DIR, MASTERS_DIR, slugify } from './media.constants';
import { MediaService } from './media.service';

class GenreDto {
  @IsString()
  name!: string;
}

class ActorDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

const imageFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  if (/^image\//.test(file.mimetype)) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
};

/** FR-29: master video can be any container ffmpeg reads (H.264/H.265/WebM/MKV/MOV…). */
const videoFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  const okMime = /^video\//.test(file.mimetype);
  const okExt = /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(file.originalname);
  if (okMime || okExt) cb(null, true);
  else cb(new Error('Only video files are allowed'), false);
};

@Controller('media')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminMediaController {
  constructor(private mediaService: MediaService) {}

  @Post()
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: POSTERS_DIR,
        filename: (_req, file, cb) => {
          const title = String(_req.body?.title ?? 'poster');
          cb(null, `${slugify(title)}-${Date.now()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: imageFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  create(@UploadedFile() file: Express.Multer.File, @Body() body: Record<string, unknown>) {
    return this.mediaService.createMovie(body, file?.filename ?? null);
  }

  @Patch(':id')
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: POSTERS_DIR,
        filename: (_req, file, cb) => {
          const title = String(_req.body?.title ?? 'poster');
          cb(null, `${slugify(title)}-${Date.now()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: imageFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  update(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    return this.mediaService.updateMovie(
      id,
      body,
      file ? file.filename : undefined,
    );
  }

  /**
   * Master video upload (single source): stored in storage/masters and fed to
   * the background transcoder, which renders 480p/720p/1080p variants.
   */
  @Post(':id/master-video')
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(MASTERS_DIR, { recursive: true });
          cb(null, MASTERS_DIR);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}-master${extname(file.originalname)}`);
        },
      }),
      fileFilter: videoFilter,
      limits: { fileSize: 8 * 1024 * 1024 * 1024 },
    }),
  )
  uploadMasterVideo(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Master video file is required');
    }
    return this.mediaService.attachMasterVideo(id, file.filename);
  }

  /** Live transcode state for admin polling. */
  @Get(':id/transcode')
  @Roles('admin')
  transcodeStatus(@Param('id', ParseIntPipe) id: number) {
    return this.mediaService.transcodeJob(id);
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.mediaService.removeMovie(id);
  }

  @Post('genres')
  @Roles('admin')
  createGenre(@Body() dto: GenreDto) {
    return this.mediaService.createGenre(dto.name);
  }

  @Patch('genres/:id')
  @Roles('admin')
  updateGenre(@Param('id', ParseIntPipe) id: number, @Body() dto: GenreDto) {
    return this.mediaService.updateGenre(id, dto.name);
  }

  @Delete('genres/:id')
  @Roles('admin')
  async deleteGenre(@Param('id', ParseIntPipe) id: number) {
    await this.mediaService.deleteGenre(id);
  }

  @Post('actors')
  @Roles('admin')
  createActor(@Body() dto: ActorDto) {
    return this.mediaService.createActor(dto.name, dto.photoUrl);
  }

  @Patch('actors/:id')
  @Roles('admin')
  updateActor(@Param('id', ParseIntPipe) id: number, @Body() dto: ActorDto) {
    return this.mediaService.updateActor(id, dto.name, dto.photoUrl);
  }

  @Delete('actors/:id')
  @Roles('admin')
  async deleteActor(@Param('id', ParseIntPipe) id: number) {
    await this.mediaService.deleteActor(id);
  }

  // ----- countries (FR-38) -----
  @Post('countries')
  @Roles('admin')
  createCountry(@Body() dto: GenreDto) {
    return this.mediaService.createCountry(dto.name);
  }

  @Patch('countries/:id')
  @Roles('admin')
  updateCountry(@Param('id', ParseIntPipe) id: number, @Body() dto: GenreDto) {
    return this.mediaService.updateCountry(id, dto.name);
  }

  @Delete('countries/:id')
  @Roles('admin')
  async deleteCountry(@Param('id', ParseIntPipe) id: number) {
    await this.mediaService.deleteCountry(id);
  }

  // ----- directors (FR-39) -----
  @Post('directors')
  @Roles('admin')
  createDirector(@Body() dto: GenreDto) {
    return this.mediaService.createDirector(dto.name);
  }

  @Patch('directors/:id')
  @Roles('admin')
  updateDirector(@Param('id', ParseIntPipe) id: number, @Body() dto: GenreDto) {
    return this.mediaService.updateDirector(id, dto.name);
  }

  @Delete('directors/:id')
  @Roles('admin')
  async deleteDirector(@Param('id', ParseIntPipe) id: number) {
    await this.mediaService.deleteDirector(id);
  }
}
