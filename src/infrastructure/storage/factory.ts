import { LocalStorageProvider } from './local';
import type { StorageProvider } from './provider';

export function createStorageProvider(outputDir: string): StorageProvider {
  return new LocalStorageProvider(outputDir);
}
