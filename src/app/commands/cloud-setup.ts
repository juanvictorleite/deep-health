import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProjectConfig } from '@core/types/config';
import {
  createOAuth2Client,
  loadStoredTokens,
  runOAuthFlow,
  saveTokens,
} from '@infra/storage/google-drive-auth';
import { CLI_NAME } from '@infra/brand';
import { confirmPrompt, selectPrompt, inputPrompt } from '@infra/utils/inquirer-prompts';
import { __ } from '@core/i18n';

interface CloudSetupOptions {
  configPath: string;
  cwd: string;
}

async function getAuthenticatedEmail(tokens: {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}): Promise<string | null> {
  try {
    const { clientId, clientSecret } = createOAuth2Client();
    const { google } = await import('googleapis');

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type,
    });

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const info = await oauth2.userinfo.get();
    return info.data.email ?? null;
  } catch {
    return null;
  }
}

async function listDriveFolders(tokens: {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}): Promise<Array<{ id: string; name: string }>> {
  const { clientId, clientSecret } = createOAuth2Client();
  const { google } = await import('googleapis');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    token_type: tokens.token_type,
  });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id,name)',
    pageSize: 50,
    orderBy: 'name',
  });

  return (response.data.files ?? []).map((f) => ({ id: f.id ?? '', name: f.name ?? '' }));
}

async function updateConfigFile(configPath: string, folderId: string): Promise<void> {
  const raw = await readFile(configPath, 'utf-8');
  const doc = JSON.parse(raw) as Record<string, unknown>;

  doc['cloud_storage'] = {
    provider: 'google_drive',
    folder_id: folderId,
  };

  await writeFile(configPath, JSON.stringify(doc, null, 2), 'utf-8');
}

export async function runCloudSetup(opts: CloudSetupOptions): Promise<number> {
  const configPath = resolve(opts.cwd, opts.configPath);

  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, 'utf-8');
  } catch {
    process.stderr.write(__('Config file not found: {{configPath}}\nRun "{{cliName}} init" first.\n', { configPath, cliName: CLI_NAME }));
    return 1;
  }

  // Validate that OAuth env vars are present before proceeding
  try {
    createOAuth2Client();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const config = JSON.parse(rawConfig) as ProjectConfig;

  // Check for existing tokens
  const existingTokens = await loadStoredTokens();
  let tokens = existingTokens;

  if (existingTokens) {
    const email = await getAuthenticatedEmail(existingTokens);
    const display = email ? `Already connected as ${email}` : 'Already connected to Google Drive';

    const reconnect = await confirmPrompt(`${display}. Reconnect?`, false);
    if (reconnect) {
      tokens = null;
    }
  }

  if (!tokens) {
    process.stdout.write(__('Starting Google OAuth 2.0 authorization flow...\n'));

    try {
      tokens = await runOAuthFlow();
      await saveTokens(tokens);
      process.stdout.write('\n');
    } catch (err) {
      process.stderr.write(
        __('OAuth flow failed: {{error}}\n', { error: err instanceof Error ? err.message : String(err) }),
      );
      return 1;
    }
  }

  const email = await getAuthenticatedEmail(tokens);
  if (email) {
    process.stdout.write(__('✔ Authenticated as: {{email}}\n', { email }));
  } else {
    process.stdout.write(__('✔ Google Drive connected.\n'));
  }

  // Ensure config has cloud_storage section (folder_id may be pre-set)
  const existingFolderId = (config.cloud_storage as { folder_id?: string } | undefined)
    ?.folder_id;

  process.stdout.write(__('Fetching Google Drive folders...\n'));

  let folders: Array<{ id: string; name: string }>;
  try {
    folders = await listDriveFolders(tokens);
  } catch (err) {
    process.stderr.write(
      __('Failed to list folders: {{error}}\n', { error: err instanceof Error ? err.message : String(err) }),
    );
    return 1;
  }

  if (folders.length === 0) {
    process.stdout.write(
      __('No folders found in your Google Drive.\nCreate a folder in Google Drive first or enter the folder ID manually.\n'),
    );
  }

  const choices: Array<{ name: string; value: string }> = [
    ...folders.map((f) => ({ name: `${f.name}  (${f.id})`, value: f.id })),
    { name: '[Enter folder ID manually]', value: '__manual__' },
  ];

  const selectedId = await selectPrompt('Select the destination folder:', choices, existingFolderId ?? undefined);

  if (!selectedId) {
    process.stdout.write(__('Setup cancelled.\n'));
    return 0;
  }

  let folderId: string = selectedId as string;

  if (folderId === '__manual__') {
    const manualId = await inputPrompt('Enter Google Drive folder ID:', existingFolderId ?? undefined);
    if (!manualId) {
      process.stdout.write(__('Setup cancelled.\n'));
      return 0;
    }
    folderId = manualId;
  }

  await updateConfigFile(configPath, folderId);
  process.stdout.write(__('\n✔ Cloud storage configured. Folder ID saved to: {{configPath}}\n', { configPath }));
  return 0;
}
