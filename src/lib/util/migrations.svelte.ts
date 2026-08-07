import { persisted } from '$lib/util/persist.svelte';

interface MigrationState {
  version: number;
}

const migrations: Record<string, () => void> = {};

const migrationState = persisted<MigrationState>('migrations', { version: -1 });

export const applyMigrations = (): void => {
  const { version } = migrationState.value;
  const allMigrations = Object.entries(migrations);
  if (version === allMigrations.length - 1) {
    return;
  }
  console.log(`Current migration version: v${version}. Migrating to v${allMigrations.length - 1}.`);
  for (let i = version + 1; i < allMigrations.length; i++) {
    const [key, fn] = allMigrations[i];
    console.log(`Applying migration ${i}: ${key}.`);
    fn();
    migrationState.value = { version: i };
  }
};
