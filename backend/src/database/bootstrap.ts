import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from './data-source';
import { UserEntity, UserRoleEnum } from '../modules/users/user.entity';
import { SubscriptionPlanEntity } from '../modules/payments/entities/subscription-plan.entity';
import { PLANS } from './plans';

/** Production initialization: no demo users, movies or password resets. */
async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      if (!(await users.existsBy({ role: UserRoleEnum.ADMIN }))) {
        const email = (process.env.INITIAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
        const password = process.env.INITIAL_ADMIN_PASSWORD ?? '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 16) {
          throw new Error('First deployment requires INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD (16+ characters)');
        }
        // Never promote an existing viewer simply because an email matches.
        if (await users.existsBy({ email })) {
          throw new Error('Initial admin email already belongs to another user; choose a different address');
        }
        await users.save(users.create({
          email,
          name: 'Administrator',
          passwordHash: await bcrypt.hash(password, 12),
          role: UserRoleEnum.ADMIN,
        }));
        console.log('Initial administrator created');
      }
      const plans = manager.getRepository(SubscriptionPlanEntity);
      for (const plan of PLANS) {
        if (!(await plans.existsBy({ tier: plan.tier }))) {
          await plans.save(plans.create({ ...plan, currency: 'usd' }));
        }
      }
    });
    console.log('Production initialization complete');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Production initialization failed:', err);
  process.exitCode = 1;
});
