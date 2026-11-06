import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Request } from 'express';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { currentUserId } from '../../common/helpers/request-user';
import { UsersService } from './users.service';
import { IsPassword } from '../../common/validators/password';
import { FileInterceptor } from '@nestjs/platform-express';
import { discardImage, imageUploadOptions, storeImage } from '../media/image-upload';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string | null;

  @IsOptional()
  @IsString()
  @IsPassword()
  password?: string;

  /** Required when `password` is set. */
  @IsOptional()
  @IsString()
  currentPassword?: string;
}

class SetRoleDto {
  @IsIn(['viewer', 'admin', 'head_admin'])
  role!: 'viewer' | 'admin' | 'head_admin';
}

class SetBlockedDto {
  @IsBoolean()
  isBlocked!: boolean;
}

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async me(@Req() req: Request) {
    // req.user is the flat JWT payload shape — serialize() needs the full
    // { user, activeSubscription } bundle, so re-resolve it from the DB.
    return this.usersService.serialize(
      await this.usersService.requireWithSubscription(currentUserId(req)),
    );
  }

  @Patch('me')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async updateMe(@Req() req: Request, @Body() dto: UpdateMeDto, @UploadedFile() file?: Express.Multer.File) {
    const avatarUrl = await storeImage(file, 'avatar');
    let updated;
    try {
      updated = await this.usersService.updateMe(currentUserId(req), {
        ...dto, ...(avatarUrl ? { avatarUrl } : {}),
      });
    } catch (error) { await discardImage(file); throw error; }
    return this.usersService.serialize(updated);
  }

  @Get()
  @Roles('admin')
  list(
    @Query('search') search = '',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.usersService.list(
      search,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
    );
  }

  @Patch(':id/role')
  @Roles('head_admin')
  async setRole(@Param('id', ParseIntPipe) id: number, @Body() dto: SetRoleDto, @Req() req: Request) {
    return this.usersService.serialize(
      await this.usersService.setRole(id, dto.role, currentUserId(req)),
    );
  }

  @Patch(':id/block')
  @Roles('admin')
  async setBlocked(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetBlockedDto,
    @Req() req: Request,
  ) {
    return this.usersService.serialize(
      await this.usersService.setBlocked(id, dto.isBlocked, currentUserId(req)),
    );
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.usersService.remove(id, currentUserId(req));
  }
}
