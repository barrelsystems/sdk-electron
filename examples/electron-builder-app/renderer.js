const policyEl = document.querySelector("#policy");
const adapterStateEl = document.querySelector("#adapter-state");
const errorEl = document.querySelector("#error");
const applyButton = document.querySelector("#apply-update");

function describePolicy(policy) {
  if (!policy) return "Waiting for first check-in…";
  switch (policy.type) {
    case "current":
      return `Current (environment: ${policy.environment}, issued ${policy.issuedAt})`;
    case "held":
      return `Held${policy.reason ? ` — ${policy.reason}` : ""} (environment: ${policy.environment})`;
    case "updateEligible":
      return `Update eligible${policy.priority ? ` (${policy.priority} priority)` : ""} (environment: ${policy.environment})`;
    default:
      return "Unknown policy";
  }
}

function describeAdapterState(adapterState) {
  if (!adapterState) return "Idle";
  switch (adapterState.type) {
    case "idle":
      return "Idle";
    case "checking":
      return "Checking for updates…";
    case "available":
      return "Update available";
    case "downloading":
      return `Downloading${adapterState.progress !== undefined ? ` (${adapterState.progress}%)` : ""}…`;
    case "downloaded":
      return "Update downloaded";
    case "update-cancelled":
      return "Update cancelled";
    case "failed":
      return `Failed (${adapterState.category}: ${adapterState.code})`;
    default:
      return "Unknown";
  }
}

async function refresh() {
  const status = await window.barrel.getStatus();
  policyEl.textContent = describePolicy(status.policy);
  adapterStateEl.textContent = describeAdapterState(status.adapterState);
  errorEl.textContent = status.lastUpdateError
    ? `${status.lastUpdateError.title} (${status.lastUpdateError.failureMode})`
    : "None this session";
}

applyButton.addEventListener("click", () => {
  void window.barrel.applyUpdate();
});

void refresh();
setInterval(refresh, 2000);
