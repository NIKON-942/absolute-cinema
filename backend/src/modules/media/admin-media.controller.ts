import {
  BadRequestException,
  Get,
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  NotFoundException,
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
import { rm } from 'fs/promises';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { POSTERS_DIR, MASTERS_DIR, slugify } from './media.constants';
import { MediaService } from './media.service';
import { POSTER_MAX_BYTES, POSTER_TYPES, validatePoster } from './upload-validation';
import { discardImage, imageUploadOptions, storeImage } from './image-upload';

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
  if (POSTER_TYPES[extname(file.originalname).toLowerCase()] === file.mimetype) cb(null, true);
  else cb(new BadRequestException('Only JPG, PNG and WebP posters are allowed'), false);
};

/** ТЗ 4.5.1: MP4 (H.264/H.265 and AAC), or WebM. */
const videoFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  if (/\.(mp4|webm)$/i.test(file.originalname)) cb(null, true);
  else cb(new BadRequestException('Only MP4 and WebM videos are allowed'), false);
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
          cb(null, `${slugify(title)}-${randomUUID()}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      fileFilter: imageFilter,
      limits: { fileSize: POSTER_MAX_BYTES },
    }),
  )
  async create(@UploadedFile() file: Express.Multer.File, @Body() body: Record<string, unknown>) {
    await validatePoster(file);
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
          cb(null, `${slugify(title)}-${randomUUID()}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      fileFilter: imageFilter,
      limits: { fileSize: POSTER_MAX_BYTES },
    }),
  )
  async update(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    await validatePoster(file);
    return this.mediaService.updateMovie(id, body, file?.filename);
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
  async uploadMasterVideo(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Master video file is required');
    }
    try { return await this.mediaService.attachMasterVideo(id, file.filename); }
    catch (error) {
      // A failure serializing the response can happen after enqueue commits.
      // Never remove a source already owned by a movie or a durable job.
      const owned = await this.mediaService.getMovieEntity(id)
        .then(movie => movie.masterVideo === file.filename || movie.pendingMasterVideo === file.filename)
        .catch(failure => !(failure instanceof NotFoundException));
      if (!owned) await rm(file.path, { force: true });
      throw error;
    }
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
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async createActor(@Body() dto: ActorDto, @UploadedFile() file?: Express.Multer.File) {
    const photoUrl = await storeImage(file, 'actor');
    try { return await this.mediaService.createActor(dto.name, photoUrl ?? dto.photoUrl); }
    catch (error) { await discardImage(file); throw error; }
  }

  @Patch('actors/:id')
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async updateActor(@Param('id', ParseIntPipe) id: number, @Body() dto: ActorDto, @UploadedFile() file?: Express.Multer.File) {
    const photoUrl = await storeImage(file, 'actor');
    try { return await this.mediaService.updateActor(id, dto.name, photoUrl ?? dto.photoUrl); }
    catch (error) { await discardImage(file); throw error; }
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
