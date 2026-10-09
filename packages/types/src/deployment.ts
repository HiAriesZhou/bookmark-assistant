/** Deployment describes the server, not a client-selected subscription tier. */
export type DeploymentMode = 'hosted' | 'self-hosted';

export interface DeploymentCapabilities {
  autoSync: boolean;
  batchAi: boolean;
}

export interface DeploymentProfile {
  deploymentMode: DeploymentMode;
  commerceEnabled: boolean;
  capabilities: DeploymentCapabilities;
}
