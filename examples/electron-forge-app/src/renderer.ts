import type { AdapterState, Policy } from '@barrel-kit/sdk-electron';
import './index.css';

const policyEl = document.querySelector<HTMLElement>('#policy');
const adapterStateEl = document.querySelector<HTMLElement>('#adapter-state');
const errorEl = document.querySelector<HTMLElement>('#error');
const applyButton = document.querySelector<HTMLButtonElement>('#apply-update');

function describePolicy(policy: Policy | undefined): string {
  if (!policy) return 'Waiting for first check-in…';
  switch (policy.type) {
    case 'current':
      return `Current (environment: ${policy.environment}, issued ${policy.issuedAt})`;
    case 'held':
      return `Held${policy.reason ? ` — ${policy.reason}` : ''} (environment: ${policy.environment})`;
    case 'updateEligible':
      return `Update eligible${policy.priority ? ` (${policy.priority} priority)` : ''} (environment: ${policy.environment})`;
  }
}

function describeAdapterState(adapterState: AdapterState | undefined): string {
  if (!adapterState) return 'Idle';
  switch (adapterState.type) {
    case 'idle':
      return 'Idle';
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return 'Update available';
    case 'downloading':
      return `Downloading${adapterState.progress !== undefined ? ` (${adapterState.progress}%)` : ''}…`;
    case 'downloaded':
      return 'Update downloaded';
    case 'update-cancelled':
      return 'Update cancelled';
    case 'failed':
      return `Failed (${adapterState.category}: ${adapterState.code})`;
  }
}

async function refresh() {
  const status = await window.barrel.getStatus();
  if (policyEl) policyEl.textContent = describePolicy(status.policy);
  if (adapterStateEl)
    adapterStateEl.textContent = describeAdapterState(status.adapterState);
  if (errorEl) {
    errorEl.textContent = status.lastUpdateError
      ? `${status.lastUpdateError.title} (${status.lastUpdateError.failureMode})`
      : 'None this session';
  }
}

applyButton?.addEventListener('click', () => {
  void window.barrel.applyUpdate();
});

void refresh();
setInterval(refresh, 2000);
