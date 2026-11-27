import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

/** Admin dashboard data, only for admins. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  /** GET /admin/analytics?days=30 (days from 1 to 730). */
  @Get('analytics')
  analytics(@Query('days') days = '30') {
    const d = Math.min(730, Math.max(1, parseInt(days, 10) || 30));
    return this.adminService.analytics(d);
  }
}
