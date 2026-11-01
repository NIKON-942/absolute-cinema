import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { currentUserId } from '../../common/helpers/request-user';
import { DevicesService } from './devices.service';

class HeartbeatDto {
  @IsString()
  @MaxLength(64)
  deviceId!: string;
}

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private devicesService: DevicesService) {}

  /**
   * Registers/refreshes the calling device. 200 while under the plan's
   * concurrent-device limit, 409 DEVICE_LIMIT once it is exceeded.
   */
  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(
    @Req() req: Request,
    @Headers('user-agent') userAgent: string | undefined,
    @Body() dto: HeartbeatDto,
  ) {
    return this.devicesService.heartbeat(
      currentUserId(req),
      dto.deviceId,
      userAgent,
    );
  }

  /** Ends this device's own session (player closed / playback stopped).
   *  Query-param based so navigator.sendBeacon can call it while unloading. */
  @Post('end')
  @HttpCode(200)
  async end(
    @Req() req: Request,
    @Query('deviceId') deviceId: string | undefined,
    @Body() body: { deviceId?: string } | undefined,
  ) {
    const id = deviceId ?? body?.deviceId;
    if (!id) throw new BadRequestException('deviceId is required');
    await this.devicesService.end(currentUserId(req), id);
    return { message: 'Device session ended' };
  }

  /** Active device sessions + the plan's device limit (profile page). */
  @Get()
  list(@Req() req: Request) {
    return this.devicesService.list(currentUserId(req));
  }

  /** Ends one of the user's device sessions, freeing a slot. */
  @Delete(':deviceId')
  async revoke(@Req() req: Request, @Param('deviceId') deviceId: string) {
    await this.devicesService.revoke(currentUserId(req), deviceId);
    return { message: 'Device disconnected' };
  }
}
