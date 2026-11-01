import { Body, Controller, Delete, Get, Head, Headers, HttpCode, HttpException, Options, Param, ParseIntPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { currentUserId } from '../../common/helpers/request-user';
import { MAX_UPLOAD_SIZE, UploadsService } from './uploads.service';

@Controller('media/uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UploadsController {
  constructor(private uploads: UploadsService) {}
  private tus(res: Response) {
    res.setHeader('Tus-Resumable', '1.0.0');
    res.setHeader('Cache-Control', 'no-store');
  }
  private version(value: string) {
    if (value !== '1.0.0') throw new HttpException('Tus-Resumable: 1.0.0 is required', 412);
  }
  @Options()
  @HttpCode(204)
  options(@Res({ passthrough: true }) res: Response) {
    this.tus(res); res.setHeader('Tus-Version', '1.0.0');
    res.setHeader('Tus-Extension', 'creation,checksum,termination');
    res.setHeader('Tus-Checksum-Algorithm', 'sha1,sha256'); res.setHeader('Tus-Max-Size', MAX_UPLOAD_SIZE);
  }
  @Get()
  list(@Req() req: Request) { return this.uploads.list(currentUserId(req)); }

  // JSON manifest is an application extension to tus creation. PATCH/HEAD
  // use the standard tus headers so a lost response can be reconciled safely.
  @Post(':movieId')
  async create(@Param('movieId', ParseIntPipe) movieId: number, @Req() req: Request,
    @Headers('tus-resumable') version: string, @Body() body: { filename: string; size: number; sha256: string; chunks: string[] },
    @Res({ passthrough: true }) res: Response) {
    this.tus(res); this.version(version);
    const upload = await this.uploads.create(movieId, currentUserId(req), body);
    res.setHeader('Location', `/api/media/uploads/${upload.id}`);
    res.setHeader('Upload-Offset', upload.offset);
    return upload;
  }
  @Head(':id')
  async head(@Param('id') id: string, @Req() req: Request, @Headers('tus-resumable') version: string,
    @Res({ passthrough: true }) res: Response) {
    this.tus(res); this.version(version);
    const u = await this.uploads.status(id, currentUserId(req));
    res.setHeader('Upload-Offset', u.offset); res.setHeader('Upload-Length', u.size);
  }
  @Get(':id')
  status(@Param('id') id: string, @Req() req: Request) { return this.uploads.status(id, currentUserId(req)); }
  @Patch(':id')
  @HttpCode(204)
  async append(@Param('id') id: string, @Req() req: Request, @Headers('tus-resumable') version: string,
    @Headers('upload-offset') offset: string, @Headers('upload-checksum') checksum: string,
    @Res({ passthrough: true }) res: Response) {
    this.tus(res); this.version(version);
    if (!/^\d+$/.test(offset) || req.headers['content-type'] !== 'application/offset+octet-stream') throw new HttpException('Invalid tus PATCH headers', 400);
    res.setHeader('Upload-Offset', await this.uploads.append(id, currentUserId(req), Number(offset), checksum, req));
  }
  @Post(':id/complete')
  @HttpCode(202)
  complete(@Param('id') id: string, @Req() req: Request) { return this.uploads.complete(id, currentUserId(req)); }
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.tus(res); await this.uploads.remove(id, currentUserId(req));
  }
}
