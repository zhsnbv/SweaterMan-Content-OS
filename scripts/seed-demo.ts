/** Development seed: one core video and a sample week. `npm run seed:demo` */
import path from 'node:path';
import { createLocalStore } from '@/lib/store';
import { ensureBootstrapped } from '@/lib/services/bootstrap';
import { seedDemo } from '@/lib/services/demo';
import { DEFAULT_WORKSPACE_ID } from '@/lib/store/defaults';
import { env } from '@/lib/env';

async function main() {
  const store = createLocalStore(path.resolve(process.cwd(), env.dataDir));
  await ensureBootstrapped(store);
  const result = await seedDemo(store, DEFAULT_WORKSPACE_ID);
  console.log(
    `Seeded ${result.coreVideoId} and ${result.units} content units for ${result.weekId}.`,
  );
  console.log('Clear it again with: npm run reset:demo');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
