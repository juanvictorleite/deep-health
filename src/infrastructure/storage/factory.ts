import type { CloudStorageConfig } from '@core/types/config';
import type { StorageProvider } from './provider';
import { createGoogleDriveProvider } from './google-drive';
import { __ } from '@core/i18n';

export async function createStorageProvider(
  config: CloudStorageConfig,
  cwd: string,
): Promise<StorageProvider> {
  switch (config.provider) {
    case 'google_drive':
      return createGoogleDriveProvider(config, cwd);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(__('Unknown cloud storage provider: {{provider}}', { provider: String(_exhaustive) }));
    }
  }
}
