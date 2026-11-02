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
} from '@nestjs/common';
import { Request } from 'express';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { currentUserId } from '../../common/helpers/request-user';
import { UsersService } from './users.service';
import { IsPassword } from '../../common/validators/password';

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
  @IsIn(['viewer', 'admin'])
  role!: 'viewer' | 'admin';
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
  async updateMe(@Req() req: Request, @Body() dto: UpdateMeDto) {
    return this.usersService.serialize(
      await this.usersService.updateMe(currentUserId(req), dto),
    );
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
  @Roles('admin')
  async setRole(@Param('id', ParseIntPipe) id: number, @Body() dto: SetRoleDto) {
    return this.usersService.serialize(
      await this.usersService.setRole(id, dto.role),
    );
  }

  @Patch(':id/block')
  @Roles('admin')
  async setBlocked(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetBlockedDto,
  ) {
    return this.usersService.serialize(
      await this.usersService.setBlocked(id, dto.isBlocked),
    );
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.usersService.remove(id);
  }
}
