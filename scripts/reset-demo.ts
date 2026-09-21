/** Wipes all content, keeping the persistent context docs. `npm run reset:demo` */
import path from 'node:path';
import { createLocalStore } from '@/lib/store';
import { env } from '@/lib/env';

async function main() {
  const store = createLocalStore(path.resolve(process.cwd(), env.dataDir));
  await store.resetContent();
  console.log('Content cleared. Context documents were kept.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
