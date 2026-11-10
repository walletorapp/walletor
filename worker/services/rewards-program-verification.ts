import bs58 from "bs58";
import { ApiFailure } from "../lib/http";

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

export interface RewardsDeployment {
  programAddress: string;
  programDataAddress: string;
  upgradeAuthority: string;
  programDataSlot: bigint;
  executableSha256: string;
}

// Deployment observed at finalized commitment. Funding also requires the
// separate launch gate; this fingerprint alone is not a source verification.
export const REWARDS_MAINNET_DEPLOYMENT: Readonly<RewardsDeployment> = {
  programAddress: "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
  programDataAddress: "BKRW5hPM4cMjNNr2EKdpScMS5kmK5bTxdELTH4LurZnu",
  upgradeAuthority: "DXtFpbPjcn2hxPnw79x1Pfoj35vXh5AsWBkS37YnXMVv",
  programDataSlot: 422571636n,
  executableSha256:
    "96a2835c4d2c0065882de9845faae7287332e84f4a5f19ef9b199c8c6034d88d",
};

export interface ProgramAccount {
  owner: string;
  executable: boolean;
  data: Uint8Array;
}

export async function assertRewardsDeployment(
  program: ProgramAccount | null,
  programData: ProgramAccount | null,
  expected: RewardsDeployment,
): Promise<void> {
  const fail = () =>
    new ApiFailure(
      503,
      "USDC_CLAIM_PROGRAM_CHANGED",
      "The claim program differs from the pinned deployment. New funding is paused until the change is reviewed.",
      false,
    );
  if (
    !program ||
    !programData ||
    program.owner !== UPGRADEABLE_LOADER ||
    programData.owner !== UPGRADEABLE_LOADER ||
    !program.executable ||
    programData.executable ||
    program.data.length !== 36 ||
    programData.data.length <= 45
  )
    throw fail();
  const programView = new DataView(
    program.data.buffer,
    program.data.byteOffset,
    program.data.byteLength,
  );
  const dataView = new DataView(
    programData.data.buffer,
    programData.data.byteOffset,
    programData.data.byteLength,
  );
  if (
    programView.getUint32(0, true) !== 2 ||
    dataView.getUint32(0, true) !== 3 ||
    bs58.encode(program.data.subarray(4, 36)) !== expected.programDataAddress ||
    dataView.getBigUint64(4, true) !== expected.programDataSlot ||
    programData.data[12] !== 1 ||
    bs58.encode(programData.data.subarray(13, 45)) !== expected.upgradeAuthority
  )
    throw fail();

  // OtterSec/solana-verify normalization: omit loader metadata and trailing padding.
  let end = programData.data.length;
  while (end > 45 && programData.data[end - 1] === 0) end -= 1;
  const executable = new Uint8Array(programData.data.subarray(45, end));
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", executable)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== expected.executableSha256) throw fail();
}
