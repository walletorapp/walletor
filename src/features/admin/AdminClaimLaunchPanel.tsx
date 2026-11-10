import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { WalletConnectionButton } from "../swap/WalletConnectionButton";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { CircleCheckBig, ExternalLink, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import {
  AdminCanaryRoundCloseResponseSchema,
  type AdminCanaryRoundCloseResult,
  type AdminBootstrap,
} from "../../../shared/admin-contracts";
import {
  UsdcClaimDistributionAdminResponseSchema,
  UsdcClaimDistributionPrepareResponseSchema,
  UsdcClaimDistributionStageInputSchema,
  type UsdcClaimDistributionAdminResult,
} from "../../../shared/usdc-claim-contracts";
import { createAdminSolanaConnection } from "./admin-solana-connection";
import { MagicBlockRequestPanel } from "./MagicBlockRequestPanel";
import { usesMagicBlock } from "../../../shared/magicblock-randomness";
import { EARLY_CLOSE_ROUND_ID } from "../../../shared/round-schedule";

interface RandomnessEvidence {
  randomnessAccount: string;
  randomnessCommitTransactionSignature: string;
  randomnessRevealTransactionSignature: string | null;
}

type BusyAction = "CLOSE_ROUND" | "FUND" | "RECOVER" | null;

class ClaimLaunchError extends Error {}

function describeSolanaTransactionError(error: unknown): string {
  let detail: string;
  try {
    detail = JSON.stringify(error);
  } catch {
    detail = String(error);
  }
  return `Solana rejected the signed transaction (${detail}). No distribution was created.`;
}

function formatPrizePoolCents(value: string): string {
  const cents = BigInt(value);
  const whole = cents / 100n;
  const remainder = (cents % 100n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${remainder}`;
}

async function adminJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error !== null &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "The claim launch operation failed.";
    throw new ClaimLaunchError(message);
  }
  return payload;
}

async function assertConfirmed(
  connection: ReturnType<typeof createAdminSolanaConnection>,
  signature: string,
  lastValidBlockHeight: number,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status?.err) {
      throw new ClaimLaunchError(describeSolanaTransactionError(status.err));
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    const blockHeight = await connection.getBlockHeight("confirmed");
    if (blockHeight > lastValidBlockHeight) {
      throw new ClaimLaunchError(
        "The Solana transaction expired before confirmation. Try again.",
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new ClaimLaunchError(
    "Solana has not confirmed the transaction yet. Check Phantom before trying again.",
  );
}

export function AdminClaimLaunchPanel({
  config,
  activeRoundId,
  activeRoundEndsAt,
  currentEligibleWallets,
  currentPrizePoolMicroUsd,
  onRoundClosed,
}: {
  config: AdminBootstrap["claimOperations"];
  activeRoundId: string;
  activeRoundEndsAt: string;
  currentEligibleWallets: number;
  currentPrizePoolMicroUsd: string;
  onRoundClosed: () => Promise<void>;
}) {
  const connection = useMemo(
    () => createAdminSolanaConnection(window.location.origin),
    [],
  );
  const wallet = useAnchorWallet();
  const { sendTransaction } = useWallet();
  const operationalRound =
    config.latestClosedRounds.find(
      (draw) =>
        draw.participantCount > 0 &&
        draw.distribution?.status !== "ACTIVE" &&
        usesMagicBlock(draw.roundId, config.magicblockFirstRoundAt),
    ) ??
    config.latestClosedRounds.find(
      (draw) =>
        draw.participantCount > 0 && draw.distribution?.status !== "ACTIVE",
    ) ??
    config.latestClosedRounds.find((draw) => draw.participantCount > 0);
  const [roundId, setRoundId] = useState(
    () =>
      operationalRound?.roundId ??
      (activeRoundId.includes(":continuation:")
        ? (activeRoundId.split(":continuation:")[0] ?? "")
        : ""),
  );
  const [evidence, setEvidence] = useState<RandomnessEvidence | null>(null);
  const [distribution, setDistribution] =
    useState<UsdcClaimDistributionAdminResult | null>(
      operationalRound?.distribution ?? null,
    );
  const [canaryClosure, setCanaryClosure] =
    useState<AdminCanaryRoundCloseResult | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectedAddress = wallet?.publicKey.toBase58() ?? null;
  const authorityMatches = connectedAddress === config.authorityAddress;
  const canFund = config.payoutsEnabled && config.fundingEnabled;
  const magicblockRound = usesMagicBlock(
    roundId,
    config.magicblockFirstRoundAt,
  );
  const canCloseTestRound =
    currentEligibleWallets > 0 &&
    BigInt(currentPrizePoolMicroUsd) >= 10_000n &&
    activeRoundId === EARLY_CLOSE_ROUND_ID &&
    config.magicblockEnabled &&
    usesMagicBlock(activeRoundId, config.magicblockFirstRoundAt);
  const selectedRoundAlreadyDistributed =
    distribution?.roundId === roundId && distribution.status === "ACTIVE";

  const begin = (action: Exclude<BusyAction, null>) => {
    setBusy(action);
    setNotice(null);
    setError(null);
  };
  const fail = (caught: unknown) => {
    setError(
      caught instanceof Error
        ? caught.message
        : "The claim launch operation failed.",
    );
    setBusy(null);
  };

  const closeTestRound = async () => {
    begin("CLOSE_ROUND");
    try {
      const payload = await adminJson(
        "/admin/api/claim-distributions/test-round/close",
        { roundId: activeRoundId },
      );
      const closed = AdminCanaryRoundCloseResponseSchema.parse(payload).data;
      setCanaryClosure(closed);
      setRoundId(closed.closedRoundId);
      setNotice(
        `The round is locked for MagicBlock. The next 24-hour round ends ${new Date(closed.continuationEndsAt).toLocaleString()}. Request randomness, then fund the distribution below.`,
      );
      await onRoundClosed();
      setBusy(null);
    } catch (caught) {
      fail(caught);
    }
  };

  const fundAndStageDistribution = async () => {
    if (
      !wallet ||
      !canFund ||
      !config.magicblockEnabled ||
      !magicblockRound ||
      !authorityMatches ||
      !evidence?.randomnessRevealTransactionSignature ||
      roundId.trim().length === 0
    ) {
      return;
    }
    begin("FUND");
    try {
      const seedSigner = Keypair.generate();
      const preparedPayload = await adminJson(
        "/admin/api/claim-distributions/prepare",
        {
          roundId: roundId.trim(),
          randomnessAccount: evidence.randomnessAccount,
          randomnessCommitTransactionSignature:
            evidence.randomnessCommitTransactionSignature,
          randomnessRevealTransactionSignature:
            evidence.randomnessRevealTransactionSignature,
          seedAddress: seedSigner.publicKey.toBase58(),
        },
      );
      const prepared =
        UsdcClaimDistributionPrepareResponseSchema.parse(preparedPayload).data;
      if (prepared.manifest.authorityAddress !== connectedAddress) {
        throw new ClaimLaunchError(
          "The connected wallet is not the configured claim authority.",
        );
      }
      const transaction = VersionedTransaction.deserialize(
        Uint8Array.from(atob(prepared.transaction), (character) =>
          character.charCodeAt(0),
        ),
      );
      const signature = await sendTransaction(transaction, connection, {
        signers: [seedSigner],
        preflightCommitment: "confirmed",
        maxRetries: 0,
      });
      await assertConfirmed(
        connection,
        signature,
        Number(prepared.lastValidBlockHeight),
      );
      const stagedPayload = await adminJson(
        "/admin/api/claim-distributions/stage",
        {
          preparationId: prepared.preparationId,
          manifest: {
            ...prepared.manifest,
            createTransactionSignature: signature,
          },
        },
      );
      const staged =
        UsdcClaimDistributionAdminResponseSchema.parse(stagedPayload).data;
      setDistribution(staged);
      setNotice(
        staged.status === "ACTIVE"
          ? "USDC is funded and winner claims activated automatically."
          : "USDC is funded. Automatic activation is queued and will retry without another wallet signature.",
      );
      setBusy(null);
    } catch (caught) {
      fail(caught);
    }
  };

  const recoverDistribution = async () => {
    begin("RECOVER");
    try {
      const payload = await adminJson(
        "/admin/api/claim-distributions/recover",
        { roundId: roundId.trim() },
      );
      if (!payload || typeof payload !== "object" || !("data" in payload))
        throw new ClaimLaunchError("Invalid distribution recovery response.");
      const recovered = UsdcClaimDistributionStageInputSchema.parse(
        payload.data,
      );
      const stagedPayload = await adminJson(
        "/admin/api/claim-distributions/stage",
        recovered,
      );
      const staged =
        UsdcClaimDistributionAdminResponseSchema.parse(stagedPayload).data;
      setDistribution(staged);
      setNotice(
        staged.status === "ACTIVE"
          ? "Existing payment verified. Winner claims are active. No additional payment was made."
          : "Existing payment verified and staged. Claim activation will retry automatically. No additional payment was made.",
      );
      await onRoundClosed();
      setBusy(null);
    } catch (caught) {
      fail(caught);
    }
  };

  return (
    <section className="admin-panel admin-claim-launch">
      <div className="admin-panel-heading">
        <span>
          <ShieldCheck aria-hidden="true" />
        </span>
        <div>
          <h2>MagicBlock · Mainnet USDC claims</h2>
          <p>MagicBlock randomness → 2.50% fee → funded Rewards distribution</p>
        </div>
      </div>

      <div className="admin-claim-launch__status">
        <span className={canFund ? "is-ready" : "is-locked"}>
          {canFund ? "MANUAL FUNDING READY" : "NEW FUNDING ON HOLD"}
        </span>
        <code>{config.authorityAddress}</code>
      </div>

      {config.payoutsEnabled && !config.fundingEnabled ? (
        <p className="admin-claim-launch__warning" role="status">
          New distributions are on hold until the claim program's deployed code
          is verified. Existing funded winner claims remain available.
        </p>
      ) : null}
      {canFund ? (
        <p className="admin-claim-launch__warning" role="status">
          Manual funding is enabled with checks against the pinned mainnet
          program. Reproducing its deployed code from published source remains
          unresolved. Each distribution requires your wallet approval.
        </p>
      ) : null}

      {!connectedAddress ? (
        <div className="admin-claim-launch__wallet">
          <p>Connect the configured authority wallet to continue.</p>
          <WalletConnectionButton />
        </div>
      ) : !authorityMatches ? (
        <p className="admin-form-message is-error" role="alert">
          Connected wallet {connectedAddress} is not the configured authority.
        </p>
      ) : null}

      {!config.payoutsEnabled ? (
        <p className="admin-claim-launch__warning">
          Funding and activation remain blocked by{" "}
          <code>PAYOUTS_ENABLED=false</code>. Open this gate only for a
          reviewed, funded launch window.
        </p>
      ) : null}

      <div className="admin-claim-launch__automation">
        <div className="admin-claim-launch__automation-heading">
          <div>
            <strong>Earlier rounds awaiting funding</strong>
            <small>
              {config.automaticSettlementEnabled
                ? "Legacy automatic settlement is configured. MagicBlock requests and funding require wallet approval; MagicBlock automation is not enabled."
                : "Walletor locks participant snapshots at the displayed round deadline. After the one-time early close, rounds run every 24 hours from that time. You approve each distribution in your wallet. Automatic spending is disabled."}
            </small>
          </div>
          <span
            className={
              config.latestClosedRounds.length > 0 ? "is-ready" : "is-locked"
            }
          >
            {config.automaticSettlementEnabled
              ? "LEGACY AUTOMATION CONFIGURED"
              : config.latestClosedRounds.length > 0
                ? "SELECT A ROUND"
                : "NO UNFUNDED ROUNDS"}
          </span>
        </div>
        {config.latestClosedRounds.length > 0 ? (
          <div className="admin-claim-launch__rounds">
            {config.latestClosedRounds.map((draw) => {
              const state =
                draw.participantCount === 0
                  ? "NO ELIGIBLE WALLETS"
                  : draw.distribution?.status === "ACTIVE"
                    ? "CLAIMS ACTIVE"
                    : draw.distribution?.status === "STAGED"
                      ? "AUTO-ACTIVATION QUEUED"
                      : config.automaticSettlementEnabled
                        ? "AUTOMATIC SETTLEMENT QUEUED"
                        : "ADMIN SIGNATURES REQUIRED";
              return (
                <button
                  type="button"
                  className={draw.roundId === roundId ? "is-selected" : ""}
                  key={draw.roundId}
                  disabled={busy !== null || draw.participantCount === 0}
                  onClick={() => {
                    setRoundId(draw.roundId);
                    setEvidence(null);
                    setDistribution(draw.distribution);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  <span>
                    <strong>{state}</strong>
                    <small>{draw.roundId}</small>
                  </span>
                  <span>
                    <strong>{formatPrizePoolCents(draw.grossPoolCents)}</strong>
                    <small>
                      {draw.participantCount} eligible wallet
                      {draw.participantCount === 1 ? "" : "s"}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="admin-claim-launch__automation-empty">
            No closed rounds with eligible wallets and an unpaid Prize Pool
            balance are available. Funded rounds remain on the claims page.
          </p>
        )}
      </div>

      {activeRoundId === EARLY_CLOSE_ROUND_ID || canaryClosure !== null ? (
        <>
          <div className="admin-claim-launch__canary">
            <div>
              <strong>One-time MagicBlock payout</strong>
              <small>
                Close this round early using only its real eligible swaps and
                Prize Pool balance. The next round starts immediately and ends
                24 hours later. This action is available only for this round.
              </small>
              <code>{activeRoundId}</code>
              <small>
                {currentEligibleWallets} eligible wallet
                {currentEligibleWallets === 1 ? "" : "s"} · round normally ends{" "}
                {new Date(activeRoundEndsAt).toLocaleString()}
              </small>
            </div>
            <button
              className="admin-primary-button"
              type="button"
              disabled={
                busy !== null ||
                !canFund ||
                !canCloseTestRound ||
                canaryClosure !== null
              }
              onClick={() => void closeTestRound()}
            >
              {busy === "CLOSE_ROUND"
                ? "Closing real round…"
                : "Close round now · restart 24 hours"}
            </button>
          </div>

          {!canCloseTestRound && canaryClosure === null ? (
            <p className="admin-claim-launch__warning">
              {activeRoundId.includes(":continuation:")
                ? "Today's early test round has already been closed. Use its locked round ID below."
                : "Complete at least one confirmed $5.00+ Walletor swap and wait for its Prize Pool credit, then refresh this page."}
            </p>
          ) : null}
        </>
      ) : null}

      {!config.magicblockEnabled || !config.magicblockFirstRoundAt ? (
        <p className="admin-claim-launch__warning" role="status">
          MagicBlock activation pending. Requests are disabled until the mainnet
          integration is ready and a first eligible daily round is configured.
          Existing funded USDC claims remain available.
        </p>
      ) : !magicblockRound ? (
        <p className="admin-claim-launch__warning" role="status">
          Select a daily round starting on or after{" "}
          {config.magicblockFirstRoundAt}. Historical and recovery rounds retain
          their original evidence and cannot be rerolled through MagicBlock.
        </p>
      ) : null}

      <div className="admin-claim-launch__steps">
        <MagicBlockRequestPanel
          key={roundId}
          roundId={roundId}
          authority={config.authorityAddress}
          enabled={
            config.magicblockEnabled &&
            magicblockRound &&
            canFund &&
            authorityMatches &&
            busy === null &&
            !selectedRoundAlreadyDistributed
          }
          connection={connection}
          onEvidence={setEvidence}
        />

        <article>
          <strong>3. Fund and stage</strong>
          <button
            className="admin-primary-button"
            type="button"
            disabled={
              busy !== null ||
              !roundId.trim() ||
              selectedRoundAlreadyDistributed
            }
            onClick={() => void recoverDistribution()}
          >
            {busy === "RECOVER"
              ? "Verifying existing payment…"
              : "Recover existing payment"}
          </button>
          <small>
            The server derives winners and exact net USDC automatically.
          </small>
          <label className="admin-field">
            <span>Locked round ID</span>
            <input
              value={roundId}
              placeholder="solana:mainnet:prize-pool:YYYY-MM-DD"
              maxLength={160}
              onChange={(event) => {
                setRoundId(event.target.value);
                setEvidence(null);
                setDistribution(null);
              }}
            />
          </label>
          <button
            className="admin-primary-button"
            type="button"
            disabled={
              busy !== null ||
              !canFund ||
              !config.magicblockEnabled ||
              !magicblockRound ||
              !authorityMatches ||
              !evidence?.randomnessRevealTransactionSignature ||
              roundId.trim().length === 0 ||
              distribution !== null
            }
            onClick={() => void fundAndStageDistribution()}
          >
            {busy === "FUND" ? "Funding…" : "Fund USDC distribution"}
          </button>
        </article>

        <article>
          <strong>4. Claims activate automatically</strong>
          <small>
            Walletor verifies the funded vault, activates claims immediately,
            and retries temporary RPC failures every minute.
          </small>
          <span
            className={`admin-claim-launch__automatic-state${
              distribution?.status === "ACTIVE" ? " is-active" : ""
            }`}
            role="status"
          >
            {distribution?.status === "ACTIVE"
              ? "WINNER CLAIMS ACTIVE"
              : distribution?.status === "STAGED"
                ? "AUTOMATIC ACTIVATION QUEUED"
                : "WAITS FOR FUNDED DISTRIBUTION"}
          </span>
        </article>
      </div>

      {evidence ? (
        <dl className="admin-claim-launch__evidence">
          <div>
            <dt>Randomness account</dt>
            <dd>{evidence.randomnessAccount}</dd>
          </div>
          <div>
            <dt>Request transaction</dt>
            <dd>{evidence.randomnessCommitTransactionSignature}</dd>
          </div>
          <div>
            <dt>Oracle callback transaction</dt>
            <dd>
              {evidence.randomnessRevealTransactionSignature ?? "Pending"}
            </dd>
          </div>
        </dl>
      ) : null}

      {distribution ? (
        <div className="admin-claim-launch__result">
          <CircleCheckBig aria-hidden="true" />
          <div>
            <strong>{distribution.status}</strong>
            <small>
              {distribution.entitlementCount} winners · checksum{" "}
              {distribution.manifestChecksum}
            </small>
            <a
              href={`https://solscan.io/account/${distribution.distributionAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              View distribution on Solscan <ExternalLink aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="admin-form-message is-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="admin-form-message is-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
