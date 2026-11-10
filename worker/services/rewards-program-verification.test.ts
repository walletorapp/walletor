// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import {
  assertRewardsDeployment,
  type ProgramAccount,
} from "./rewards-program-verification";

function fixture() {
  const code = new Uint8Array([127, 69, 76, 70, 1, 2, 3, 4]);
  const expected = {
    programAddress: "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
    programDataAddress: "BKRW5hPM4cMjNNr2EKdpScMS5kmK5bTxdELTH4LurZnu",
    upgradeAuthority: "DXtFpbPjcn2hxPnw79x1Pfoj35vXh5AsWBkS37YnXMVv",
    programDataSlot: 422571636n,
    executableSha256: createHash("sha256").update(code).digest("hex"),
  };
  const owner = "BPFLoaderUpgradeab1e11111111111111111111111";
  const program: ProgramAccount = {
    owner,
    executable: true,
    data: new Uint8Array(36),
  };
  new DataView(program.data.buffer).setUint32(0, 2, true);
  program.data.set(bs58.decode(expected.programDataAddress), 4);
  const programData: ProgramAccount = {
    owner,
    executable: false,
    data: new Uint8Array(70),
  };
  const view = new DataView(programData.data.buffer);
  view.setUint32(0, 3, true);
  view.setBigUint64(4, expected.programDataSlot, true);
  programData.data[12] = 1;
  programData.data.set(bs58.decode(expected.upgradeAuthority), 13);
  programData.data.set(code, 45);
  return { program, programData, expected };
}

describe("reviewed mainnet program pin", () => {
  it("accepts the reviewed code with unused allocation padding", async () => {
    const f = fixture();
    await expect(
      assertRewardsDeployment(f.program, f.programData, f.expected),
    ).resolves.toBeUndefined();
  });
  it.each([
    "code",
    "slot",
    "authority",
    "pointer",
    "owner",
    "executable",
    "missing",
  ])("blocks funding after a change to %s", async (change) => {
    const f = fixture();
    if (change === "code") f.programData.data[49] = 255;
    if (change === "slot") f.programData.data[4] = 255;
    if (change === "authority") f.programData.data[13] = 255;
    if (change === "pointer") f.program.data[4] = 255;
    if (change === "owner") f.programData.owner = f.expected.programAddress;
    if (change === "executable") f.program.executable = false;
    await expect(
      assertRewardsDeployment(
        f.program,
        change === "missing" ? null : f.programData,
        f.expected,
      ),
    ).rejects.toMatchObject({ code: "USDC_CLAIM_PROGRAM_CHANGED" });
  });
});
