/**
 * Barrel test for src/infrastructure/provisioner/index.ts
 */
import {
  DockerSonarQubeProvisioner,
  DockerSonarScannerRunner,
  OsvDockerRunner,
} from '@infra/provisioner/index';
import { describe, it, expect } from 'vitest';



describe('src/infrastructure/provisioner/index.ts barrel exports', () => {
  it('DockerSonarQubeProvisioner is exported', () => {
    expect(typeof DockerSonarQubeProvisioner).toBe('function');
  });

  it('DockerSonarScannerRunner is exported', () => {
    expect(typeof DockerSonarScannerRunner).toBe('function');
  });

  it('OsvDockerRunner is exported', () => {
    expect(typeof OsvDockerRunner).toBe('function');
  });
});
