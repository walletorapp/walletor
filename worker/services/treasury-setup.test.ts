import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { useReferral } from "@jup-ag/referral-sdk";
import { Buffer } from "buffer";
import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
} from "../../shared/usdc-claim-contracts";
import {
  JUPITER_REFERRAL_PROGRAM_ADDRESS,
  REWARDS_AUTOMATION_ADDRESS,
} from "../../shared/treasury-setup-contracts";
import {
  prepareTreasurySetup,
  referralTransferInstruction,
} from "./treasury-setup";

afterEach(() => vi.restoreAllMocks());

describe("one-time rewards treasury authorization", () => {
  it.each([
    ["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", true],
    ["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", false],
    ["EtWTRABZaYq6iMfeYKouRu166VU2xqa1", false],
  ])("checks the full RPC genesis hash: %s", async (genesis, accepted) => {
    const signer = Keypair.generate();
    vi.spyOn(signer, "publicKey", "get").mockReturnValue(
      new PublicKey(REWARDS_AUTOMATION_ADDRESS),
    );
    vi.spyOn(Keypair, "fromSecretKey").mockReturnValue(signer);
    vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(genesis);
    const partner = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
    const data = Buffer.alloc(274);
    data.set(
      sha256(new TextEncoder().encode("account:ReferralAccount")).slice(0, 8),
    );
    data.set(new PublicKey(partner).toBytes(), 8);
    data.writeUInt16LE(8000, 72);
    const accountRead = vi
      .spyOn(Connection.prototype, "getAccountInfo")
      .mockResolvedValue({
        data,
        executable: false,
        lamports: 1,
        owner: new PublicKey(JUPITER_REFERRAL_PROGRAM_ADDRESS),
        rentEpoch: 0,
      });
    const result = prepareTreasurySetup(
      {
        JUPITER_REFERRAL_FEE_ENABLED: "true",
        JUPITER_REFERRAL_ACCOUNT:
          "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ",
        JUPITER_REFERRAL_FEE_BPS: "50",
        JUPITER_PARTNER_SHARE_BPS: "8000",
        SOLANA_CLAIM_NETWORK: "mainnet",
        SOLANA_CLAIM_PROGRAM_ID: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
        SOLANA_CLAIM_AUTHORITY_ADDRESS:
          "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
        SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
        SOLANA_SWITCHBOARD_PROGRAM_ID: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
        SOLANA_SWITCHBOARD_QUEUE_ADDRESS:
          SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
        PRIZE_POOL_CLAIM_FEE_BPS: "250",
        WALLETOR_TREASURY_ADDRESS: partner,
      },
      false,
    );
    if (accepted) {
      await expect(result).resolves.toMatchObject({
        currentPartner: partner,
        partnerShareBps: 8000,
        authorized: false,
        transaction: null,
      });
    } else {
      await expect(result).rejects.toMatchObject({
        code: "TREASURY_WRONG_NETWORK",
      });
      expect(accountRead).not.toHaveBeenCalled();
    }
  });
  it("matches the official Jupiter SDK instruction and requires the current partner", async () => {
    const referral = Keypair.generate().publicKey;
    const partner = Keypair.generate().publicKey;
    const project = Keypair.generate().publicKey;
    const data = Buffer.alloc(78);
    data.set(
      sha256(new TextEncoder().encode("account:ReferralAccount")).slice(0, 8),
    );
    data.set(partner.toBytes(), 8);
    data.set(project.toBytes(), 40);
    data.writeUInt16LE(8000, 72);
    vi.spyOn(
      Connection.prototype,
      "getAccountInfoAndContext",
    ).mockResolvedValue({
      context: { slot: 1 },
      value: {
        data,
        executable: false,
        lamports: 1,
        owner: new PublicKey(JUPITER_REFERRAL_PROGRAM_ADDRESS),
        rentEpoch: 0,
      },
    });
    const sdk = useReferral(
      new Connection("https://api.mainnet-beta.solana.com"),
    );
    const expected = await sdk.transferReferralAccount({
      referralAccountPubKey: referral,
      newPartnerPubKey: new PublicKey(REWARDS_AUTOMATION_ADDRESS),
    });
    const actual = referralTransferInstruction(
      referral.toBase58(),
      partner.toBase58(),
    );
    const expectedInstruction = expected.instructions[0];
    expect(expectedInstruction).toBeDefined();
    expect(actual.programId.toBase58()).toEqual(
      expectedInstruction?.programId.toBase58(),
    );
    expect(Array.from(actual.data)).toEqual(
      Array.from(expectedInstruction?.data ?? []),
    );
    expect(
      actual.keys.map((key) => ({ ...key, pubkey: key.pubkey.toBase58() })),
    ).toEqual(
      expectedInstruction?.keys.map((key) => ({
        ...key,
        pubkey: key.pubkey.toBase58(),
      })),
    );
    expect(
      actual.keys
        .filter((key) => key.isSigner)
        .map((key) => key.pubkey.toBase58()),
    ).toEqual([partner.toBase58()]);
  });
  it("refuses preparation without the provisioned automation signer", async () => {
    await expect(
      prepareTreasurySetup(
        {
          AUTOMATIC_CLAIM_SETTLEMENT_ENABLED: "true",
          JUPITER_REFERRAL_FEE_ENABLED: "true",
          JUPITER_REFERRAL_ACCOUNT:
            "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ",
          JUPITER_REFERRAL_FEE_BPS: "50",
          JUPITER_PARTNER_SHARE_BPS: "8000",
        },
        true,
      ),
    ).rejects.toThrow("provisioned automation signer");
  });
  it("blocks an automation ownership transfer in manual mode before reading secrets or RPC", async () => {
    const signerRead = vi.spyOn(Keypair, "fromSecretKey");
    const rpcRead = vi.spyOn(Connection.prototype, "getGenesisHash");
    await expect(
      prepareTreasurySetup(
        { AUTOMATIC_CLAIM_SETTLEMENT_ENABLED: "false" },
        true,
      ),
    ).rejects.toMatchObject({ code: "MANUAL_TREASURY_MODE" });
    expect(signerRead).not.toHaveBeenCalled();
    expect(rpcRead).not.toHaveBeenCalled();
  });
});
