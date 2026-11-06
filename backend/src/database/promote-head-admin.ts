import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { UserEntity, UserRoleEnum } from '../modules/users/user.entity';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--email' || !args[1].trim()) {
    throw new Error('Usage: node dist/database/promote-head-admin.js --email existing-admin@example.com');
  }
  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async em => {
      await em.query('SELECT pg_advisory_xact_lock(1702, 1)');
      const user = await em.findOneBy(UserEntity, { email: args[1].trim().toLowerCase() });
      if (!user || user.isBlocked || ![UserRoleEnum.ADMIN, UserRoleEnum.HEAD_ADMIN].includes(user.role)) {
        throw new Error('Choose an existing, unblocked administrator; viewers are never promoted by this command');
      }
      await em.update(UserEntity, user.id, { role: UserRoleEnum.HEAD_ADMIN });
      console.log(`Head administrator assigned: user #${user.id}`);
    });
  } finally {
    await AppDataSource.destroy();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
