import { ecosystemEntryKey } from '@core/types/config';
import type { ProjectConfig } from '@core/types/config';
import type { ScanResultJson } from '@core/types/scan';

/**
 * Every artifact kind `generateAndSaveReportArtifacts` can dispatch to a generator for.
 * The plan is the sole authority for which of these are selected — the executor never
 * re-derives selection from generator output.
 */
export type ArtifactKind =
  | 'markdown-consolidated'
  | 'markdown-split'
  | 'docx-consolidated'
  | 'docx-split'
  | 'sonarqube-html';

export interface ArtifactDescriptor {
  kind: ArtifactKind;
  /** Present only for '*-split' descriptors — the ecosystem entry this artifact covers. */
  entryKey?: string;
}

export interface ArtifactPlan {
  markdownEnabled: boolean;
  docxEnabled: boolean;
  descriptors: ArtifactDescriptor[];
}

export interface ResolveArtifactPlanInput {
  config: ProjectConfig;
  splitReports?: boolean;
  engineResults?: Record<string, ScanResultJson>;
}

function resolveFormatFlags(config: ProjectConfig): { markdownEnabled: boolean; docxEnabled: boolean } {
  const formats = config.outputs?.formats ?? [];
  return { markdownEnabled: formats.includes('markdown'), docxEnabled: formats.includes('docx') };
}

function resolveSplitReportsEnabled(input: ResolveArtifactPlanInput): boolean {
  return input.splitReports ?? input.config.outputs?.split_reports ?? false;
}

export function resolveArtifactPlan(input: ResolveArtifactPlanInput): ArtifactPlan {
  const { markdownEnabled, docxEnabled } = resolveFormatFlags(input.config);

  if (!markdownEnabled && !docxEnabled) {
    return { markdownEnabled, docxEnabled, descriptors: [] };
  }

  const useSplitMode = resolveSplitReportsEnabled(input) && input.config.ecosystems.length > 0;
  const descriptors = useSplitMode
    ? resolveSplitDescriptors(input.config, markdownEnabled, docxEnabled)
    : resolveConsolidatedDescriptors(markdownEnabled, docxEnabled);

  if (shouldGenerateSonarHtml(input.engineResults)) {
    descriptors.push({ kind: 'sonarqube-html' });
  }

  return { markdownEnabled, docxEnabled, descriptors };
}

function resolveSplitDescriptors(
  config: ProjectConfig,
  markdownEnabled: boolean,
  docxEnabled: boolean,
): ArtifactDescriptor[] {
  const descriptors: ArtifactDescriptor[] = [];
  for (const ecoEntry of config.ecosystems) {
    const entryKey = ecosystemEntryKey(ecoEntry);
    if (markdownEnabled) descriptors.push({ kind: 'markdown-split', entryKey });
    if (docxEnabled) descriptors.push({ kind: 'docx-split', entryKey });
  }
  return descriptors;
}

function resolveConsolidatedDescriptors(
  markdownEnabled: boolean,
  docxEnabled: boolean,
): ArtifactDescriptor[] {
  const descriptors: ArtifactDescriptor[] = [];
  if (markdownEnabled) descriptors.push({ kind: 'markdown-consolidated' });
  if (docxEnabled) descriptors.push({ kind: 'docx-consolidated' });
  return descriptors;
}

/**
 * Mirrors generateSonarQubeHtmlReport's own null-return guard (missing engineResults,
 * missing sonarqube entry, or a skipped scan) so the plan — not the generator — decides
 * whether the sonarqube-html artifact is produced.
 */
function shouldGenerateSonarHtml(engineResults: Record<string, ScanResultJson> | undefined): boolean {
  const sonarResult = engineResults?.['sonarqube'];
  return sonarResult !== undefined && sonarResult.status !== 'skipped';
}
