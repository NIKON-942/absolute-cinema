import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentTransactionEntity } from './entities/payment-transaction.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionPlanEntity } from './entities/subscription-plan.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PlanLimitsService } from './plan-limits.service';

@Module({
  imports: [
    ScheduleModule,
    TypeOrmModule.forFeature([
      SubscriptionPlanEntity,
      SubscriptionEntity,
      PaymentTransactionEntity,
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PlanLimitsService],
  exports: [PaymentsService, PlanLimitsService],
})
export class PaymentsModule {}
