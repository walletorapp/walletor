import { sha256 } from "@noble/hashes/sha2";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import {
  JUPITER_REFERRAL_PROGRAM_ADDRESS,
  REWARDS_AUTOMATION_ADDRESS,
} from "../../shared/treasury-setup-contracts";
import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import { getJupiterReferralConfig } from "./jupiter-referral";
import { SOLANA_MAINNET_GENESIS_HASH } from "../../shared/solana-network";
import { ApiFailure } from "../lib/http";

export function referralTransferInstruction(
  referral: string,
  partner: string,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(JUPITER_REFERRAL_PROGRAM_ADDRESS),
    keys: [
      { pubkey: new PublicKey(partner), isSigner: true, isWritable: false },
      {
        pubkey: new PublicKey(REWARDS_AUTOMATION_ADDRESS),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: new PublicKey(referral), isSigner: false, isWritable: true },
    ],
    data: Buffer.from(
      sha256(
        new TextEncoder().encode("global:transfer_referral_account"),
      ).slice(0, 8),
    ),
  });
}

type TreasurySetupEnvironment = Omit<
  Partial<Env>,
  "AUTOMATIC_CLAIM_SETTLEMENT_ENABLED"
> & {
  AUTOMATIC_CLAIM_SETTLEMENT_ENABLED?: string;
};

export async function prepareTreasurySetup(
  env: TreasurySetupEnvironment,
  build: boolean,
) {
  if (build && env.AUTOMATIC_CLAIM_SETTLEMENT_ENABLED !== "true") {
    throw new ApiFailure(
      409,
      "MANUAL_TREASURY_MODE",
      "Manual funding is enabled. Referral fees remain under your wallet's control; transfer to automation is disabled.",
      false,
    );
  }
  const referral = getJupiterReferralConfig(env);
  if (!referral) throw new Error("Jupiter referral fees are not configured.");
  const secret = env.SOLANA_CLAIM_AUTOMATION_SECRET?.trim();
  if (
    build &&
    (!secret ||
      Keypair.fromSecretKey(bs58.decode(secret)).publicKey.toBase58() !==
        REWARDS_AUTOMATION_ADDRESS)
  ) {
    throw new Error(
      "The provisioned automation signer does not match the destination.",
    );
  }
  const connection = new Connection(readUsdcClaimConfig(env).rpcUrl, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
  if ((await connection.getGenesisHash()) !== SOLANA_MAINNET_GENESIS_HASH) {
    throw new ApiFailure(
      503,
      "TREASURY_WRONG_NETWORK",
      "Treasury setup requires Solana mainnet. The configured RPC returned a different network.",
      false,
    );
  }
  const account = await connection.getAccountInfo(
    new PublicKey(referral.account),
  );
  const discriminator = sha256(
    new TextEncoder().encode("account:ReferralAccount"),
  ).slice(0, 8);
  if (
    !account ||
    account.executable ||
    account.owner.toBase58() !== JUPITER_REFERRAL_PROGRAM_ADDRESS ||
    account.data.length < 78 ||
    !discriminator.every((byte, index) => account.data[index] === byte)
  ) {
    throw new Error("The on-chain Jupiter referral account is invalid.");
  }
  const currentPartner = new PublicKey(account.data.subarray(8, 40)).toBase58();
  const partnerShareBps = account.data.readUInt16LE(72);
  if (partnerShareBps !== referral.partnerShareBps)
    throw new Error("Jupiter's fee share differs from Walletor configuration.");
  const authorized = currentPartner === REWARDS_AUTOMATION_ADDRESS;
  if (!authorized && currentPartner !== env.WALLETOR_TREASURY_ADDRESS) {
    throw new Error(
      "The referral beneficiary differs from the expected treasury.",
    );
  }
  const result = {
    referralAccount: referral.account,
    currentPartner,
    automationAddress: REWARDS_AUTOMATION_ADDRESS,
    partnerShareBps,
    authorized,
  };
  if (!build || authorized)
    return {
      ...result,
      transaction: null,
      blockhash: null,
      lastValidBlockHeight: null,
    };
  const lifetime = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: new PublicKey(currentPartner),
    ...lifetime,
  }).add(referralTransferInstruction(referral.account, currentPartner));
  return {
    ...result,
    ...lifetime,
    transaction: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  };
}
