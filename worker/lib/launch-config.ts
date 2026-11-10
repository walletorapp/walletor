import { ApiFailure } from "./http";

const LEGACY_ACCOUNTING_EPOCH = "prelaunch";
const EPOCH_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

interface LaunchEnvironment {
  WALLETOR_ACCOUNTING_EPOCH?: string;
  WALLETOR_PUBLIC_LAUNCH_AT?: string;
}

export function readAccountingEpoch(env: LaunchEnvironment): string {
  const configured = env.WALLETOR_ACCOUNTING_EPOCH?.trim();
  if (!configured) return LEGACY_ACCOUNTING_EPOCH;
  if (!EPOCH_PATTERN.test(configured)) {
    throw new ApiFailure(
      503,
      "LAUNCH_CONFIGURATION_INVALID",
      "Walletor launch accounting is temporarily unavailable.",
      false,
    );
  }
  return configured;
}

export function readPublicLaunchAt(env: LaunchEnvironment): string | null {
  const configured = env.WALLETOR_PUBLIC_LAUNCH_AT?.trim();
  if (!configured) return null;
  const timestamp = Date.parse(configured);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== configured
  ) {
    throw new ApiFailure(
      503,
      "LAUNCH_CONFIGURATION_INVALID",
      "Walletor launch history is temporarily unavailable.",
      false,
    );
  }
  return configured;
}
