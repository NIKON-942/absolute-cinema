import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MovieEntity } from '../media/entities/movie.entity';
import { SubscriptionEntity } from '../payments/entities/subscription.entity';
import { PaymentTransactionEntity } from '../payments/entities/payment-transaction.entity';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      MovieEntity,
      SubscriptionEntity,
      PaymentTransactionEntity,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
