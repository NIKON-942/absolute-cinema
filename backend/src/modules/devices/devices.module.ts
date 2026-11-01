import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionEntity } from '../payments/entities/subscription.entity';
import { PaymentsModule } from '../payments/payments.module';
import { DeviceSessionEntity } from './device-session.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [
    PaymentsModule,
    TypeOrmModule.forFeature([DeviceSessionEntity, SubscriptionEntity]),
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
