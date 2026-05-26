import type { EcosystemConfig } from '@core/types/config';

/**
 * Derives a unique string key for a single ecosystem config entry.
 *
 * Key format:
 *   - `<id>`          when the entry has no label (single-plugin entries)
 *   - `<id>:<label>`  when the entry has a label (monorepo multi-entry disambiguation)
 *
 * The colon separator mirrors the `id:label` composite used in reports and
 * audit trails so consumers can parse the key back into its components when
 * needed. The separator is chosen to be invalid in plugin ids and labels
 * (plugin ids are lower-case alphanumeric; labels are ^[a-z0-9-]+$), so
 * the key is unambiguous.
 *
 * @example
 * ecosystemEntryKey({ id: 'npm' })                        // → 'npm'
 * ecosystemEntryKey({ id: 'npm', label: 'frontend' })     // → 'npm:frontend'
 * ecosystemEntryKey({ id: 'pip', label: 'api' })          // → 'pip:api'
 */
export function ecosystemEntryKey(entry: Pick<EcosystemConfig, 'id' | 'label'>): string {
  return entry.label ? `${entry.id}:${entry.label}` : entry.id;
}
