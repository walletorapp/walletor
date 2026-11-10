import {
  Activity,
  ArrowUpRight,
  CircleDollarSign,
  Database,
  LogOut,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode, type SyntheticEvent } from "react";

import {
  AdminBootstrapResponseSchema,
  AdminSettingsResponseSchema,
  type AdminBootstrap,
  type AdminRuntimeSettings,
  type AdminRuntimeSettingsInput,
  type AdminSwap,
} from "../../../shared/admin-contracts";
import { AdminClaimLaunchPanel } from "./AdminClaimLaunchPanel";
import { AdminTreasurySetupPanel } from "./AdminTreasurySetupPanel";
import { AdminPrizeSeedPanel } from "./AdminPrizeSeedPanel";
import { AdminAffiliatePanel } from "./AdminAffiliatePanel";
import { AdminFeeReservePanel } from "./AdminFeeReservePanel";
import { AdminInfluencerPanel } from "./AdminInfluencerPanel";
import "./admin-dashboard.css";

class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function adminRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorDetails = readErrorDetails(payload);
    throw new AdminApiError(
      response.status,
      errorDetails?.code ?? "ADMIN_REQUEST_FAILED",
      errorDetails?.message ?? "Walletor Admin could not load this request.",
    );
  }
  return payload;
}

async function loadAdmin(): Promise<AdminBootstrap> {
  const payload = await adminRequest("/admin/api/bootstrap", {
    cache: "no-store",
  });
  return AdminBootstrapResponseSchema.parse(payload).data;
}

async function saveSettings(
  settings: AdminRuntimeSettingsInput,
): Promise<AdminRuntimeSettings> {
  const payload = await adminRequest("/admin/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return AdminSettingsResponseSchema.parse(payload).data;
}

export function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const admin = useQuery({
    queryKey: ["walletor-admin"],
    queryFn: loadAdmin,
    retry: false,
  });
  const settingsMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["walletor-admin"] });
    },
  });

  if (admin.isPending) return <AdminLoading />;
  if (admin.isError) return <AdminError error={admin.error} />;

  const data = admin.data;
  const ledger = data.ledger;
  return (
    <div className="admin-page">
      <header className="admin-topbar">
        <a className="admin-brand" href="/" aria-label="Walletor home">
          <img src="/assets/walletor-logo-animated.gif" alt="" />
          <span>
            <strong>Walletor</strong>
            <small>Admin control center</small>
          </span>
        </a>
        <div className="admin-session">
          <span className="admin-session__identity">
            <ShieldCheck aria-hidden="true" />
            <span>
              <small>SECURE SESSION</small>
              <strong>{data.actor.email}</strong>
            </span>
          </span>
          <button
            className="admin-icon-button"
            type="button"
            onClick={() => void admin.refetch()}
            aria-label="Refresh admin data"
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <a
            className="admin-icon-button"
            href="/cdn-cgi/access/logout"
            aria-label="Sign out of Walletor Admin"
          >
            <LogOut aria-hidden="true" />
          </a>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-hero">
          <div>
            <p className="admin-eyebrow">OPERATIONS OVERVIEW</p>
            <h1>Walletor Admin</h1>
            <p>
              Live operational visibility across Solana traders, swaps, rewards,
              Prize Pool accounting, and Cloudflare D1.
            </p>
          </div>
          <div className="admin-live-state">
            <span
              className={`admin-state-dot is-${ledger.accountingStatus.toLowerCase()}`}
            />
            <span>
              <small>ACCOUNTING ENGINE</small>
              <strong>{ledger.accountingStatus}</strong>
            </span>
          </div>
        </section>

        <div className="admin-readonly-notice">
          <ShieldCheck aria-hidden="true" />
          <p>
            <strong>Authoritative records are read-only.</strong> The claim
            launcher below can close the controlled test round and create a
            wallet-signed mainnet USDC distribution.
          </p>
        </div>

        <section className="admin-metrics" aria-label="Walletor metrics">
          <Metric
            icon={<CircleDollarSign />}
            label="Live Prize Pool"
            value={formatMoney(ledger.currentPrizePoolMicroUsd, 6)}
            detail={`${formatMoney(ledger.totalCollectedMicroUsd, 6)} collected`}
          />
          <Metric
            icon={<Activity />}
            label="Confirmed swaps"
            value={formatInteger(ledger.confirmedSwapCount)}
            detail={`${formatInteger(ledger.pendingAccountingCount)} awaiting accounting`}
          />
          <Metric
            icon={<Users />}
            label="Trader wallets"
            value={formatInteger(ledger.traderCount)}
            detail={`${formatInteger(ledger.currentEligibleWallets)} eligible this round`}
          />
          <Metric
            icon={<Database />}
            label="WLT points issued"
            value={formatInteger(ledger.lifetimeWltPoints)}
            detail={`${formatInteger(data.database.discoveredTokenCount)} tokens indexed in D1`}
          />
        </section>

        <div className="admin-grid admin-grid--status">
          <section className="admin-panel">
            <PanelHeading
              icon={<Activity />}
              title="System health"
              subtitle="Live Worker, accounting, and ingestion signals"
            />
            <dl className="admin-health-list">
              <HealthRow
                label="Accounting failures"
                value={formatInteger(ledger.accountingFailureCount)}
                alert={ledger.accountingFailureCount > 0}
              />
              <HealthRow
                label="Pending accounting"
                value={formatInteger(ledger.pendingAccountingCount)}
                alert={ledger.pendingAccountingCount > 0}
              />
              <HealthRow label="Active round" value={ledger.activeRoundId} />
              <HealthRow
                label="Round ends"
                value={formatDateTime(ledger.activeRoundEndsAt)}
              />
            </dl>
          </section>
          <section className="admin-panel">
            <PanelHeading
              icon={<Database />}
              title="Cloudflare D1"
              subtitle={data.database.databaseName}
            />
            <dl className="admin-health-list">
              <HealthRow
                label="Discovered tokens"
                value={formatInteger(data.database.discoveredTokenCount)}
              />
              <HealthRow
                label="Pump.fun tokens"
                value={formatInteger(data.database.pumpfunTokenCount)}
              />
              <HealthRow
                label="Referral fee mints"
                value={formatInteger(data.database.referralFeeMintCount)}
              />
              <HealthRow
                label="Pending fee mints"
                value={formatInteger(data.database.pendingReferralFeeMintCount)}
                alert={data.database.pendingReferralFeeMintCount > 0}
              />
            </dl>
          </section>
        </div>

        <section className="admin-panel admin-table-panel">
          <PanelHeading
            icon={<Users />}
            title="Trader accounts"
            subtitle="Wallet activity aggregated from the authoritative accounting ledger"
          />
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Confirmed</th>
                  <th>Eligible</th>
                  <th>Eligible volume</th>
                  <th>WLT points</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {ledger.traders.length === 0 ? (
                  <EmptyTable
                    colSpan={6}
                    label="No trader activity recorded yet."
                  />
                ) : (
                  ledger.traders.map((trader) => (
                    <tr key={trader.walletAddress}>
                      <td>
                        <a
                          className="admin-wallet-link"
                          href={`https://solscan.io/account/${trader.walletAddress}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortAddress(trader.walletAddress)}
                          <ArrowUpRight aria-hidden="true" />
                        </a>
                      </td>
                      <td>{formatInteger(trader.confirmedSwaps)}</td>
                      <td>{formatInteger(trader.eligibleSwaps)}</td>
                      <td>{formatMoney(trader.eligibleVolumeCents, 2)}</td>
                      <td>{formatInteger(trader.lifetimeWltPoints)}</td>
                      <td>{formatDateTime(trader.lastActiveAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel admin-table-panel">
          <PanelHeading
            icon={<Activity />}
            title="Recent swaps"
            subtitle="Execution and reward-accounting status"
          />
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Trader</th>
                  <th>Input atomic</th>
                  <th>Output atomic</th>
                  <th>Walletor fee</th>
                  <th>Prize Pool</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {ledger.recentSwaps.length === 0 ? (
                  <EmptyTable colSpan={7} label="No swaps recorded yet." />
                ) : (
                  ledger.recentSwaps.map((swap) => (
                    <SwapRow key={swap.requestId} swap={swap} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <AdminPrizeSeedPanel />
        <AdminFeeReservePanel />
        <AdminInfluencerPanel />
        <AdminAffiliatePanel />
        <AdminTreasurySetupPanel
          authorityAddress={data.claimOperations.authorityAddress}
          automaticSettlementEnabled={
            data.claimOperations.automaticSettlementEnabled
          }
        />
        <AdminClaimLaunchPanel
          config={data.claimOperations}
          activeRoundId={ledger.activeRoundId}
          activeRoundEndsAt={ledger.activeRoundEndsAt}
          currentEligibleWallets={ledger.currentEligibleWallets}
          currentPrizePoolMicroUsd={ledger.currentPrizePoolMicroUsd}
          onRoundClosed={async () => {
            await queryClient.invalidateQueries({
              queryKey: ["walletor-admin"],
            });
          }}
        />

        <div className="admin-grid admin-grid--controls">
          <section className="admin-panel">
            <PanelHeading
              icon={<Settings2 />}
              title="Site controls"
              subtitle="Non-financial content stored centrally in D1"
            />
            <SiteControls
              key={data.settings.updatedAt ?? "default-settings"}
              initialSettings={data.settings}
              isPending={settingsMutation.isPending}
              isSuccess={settingsMutation.isSuccess}
              error={settingsMutation.error}
              onSave={(input) => {
                settingsMutation.mutate(input);
              }}
            />
          </section>

          <section className="admin-panel">
            <PanelHeading
              icon={<ShieldCheck />}
              title="Admin audit log"
              subtitle="Append-only changes made through this dashboard"
            />
            <ol className="admin-audit-list">
              {data.auditEvents.length === 0 ? (
                <li className="admin-empty-state">No admin changes yet.</li>
              ) : (
                data.auditEvents.map((event) => (
                  <li key={event.id}>
                    <span className="admin-audit-icon">
                      <Settings2 aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{humanizeAction(event.action)}</strong>
                      <small>{event.actorEmail}</small>
                    </span>
                    <time dateTime={event.createdAt}>
                      {formatDateTime(event.createdAt)}
                    </time>
                  </li>
                ))
              )}
            </ol>
          </section>
        </div>

        <footer className="admin-footer">
          Last synchronized {formatDateTime(data.generatedAt)} · Financial
          records are immutable in this interface.
        </footer>
      </main>
    </div>
  );
}

function AdminLoading() {
  return (
    <main className="admin-gate-state" aria-live="polite">
      <span className="admin-loader" />
      <h1>Opening Walletor Admin</h1>
      <p>Verifying the secure Cloudflare Access session.</p>
    </main>
  );
}

function AdminError({ error }: { error: Error }) {
  const accessError = error instanceof AdminApiError;
  const needsConfiguration =
    accessError && error.code === "ADMIN_ACCESS_NOT_CONFIGURED";
  return (
    <main className="admin-gate-state is-error">
      <ShieldCheck aria-hidden="true" />
      <p className="admin-eyebrow">SECURE ADMIN</p>
      <h1>
        {needsConfiguration ? "Access setup required" : "Access unavailable"}
      </h1>
      <p>{error.message}</p>
      <div className="admin-gate-actions">
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          Try again
        </button>
        <a href="/">Return to Walletor</a>
      </div>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="admin-metric">
      <span className="admin-metric__icon">{icon}</span>
      <span className="admin-metric__label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PanelHeading({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="admin-panel-heading">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function HealthRow({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={alert ? "is-alert" : ""}>{value}</dd>
    </div>
  );
}

function EmptyTable({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td className="admin-empty-table" colSpan={colSpan}>
        {label}
      </td>
    </tr>
  );
}

function SwapRow({ swap }: { swap: AdminSwap }) {
  return (
    <tr>
      <td>
        <span className={`admin-status-pill is-${swap.status.toLowerCase()}`}>
          {swap.status}
        </span>
        {swap.accountingError ? (
          <small className="admin-cell-error" title={swap.accountingError}>
            Retry {swap.accountingAttempts}
          </small>
        ) : null}
      </td>
      <td>{shortAddress(swap.walletAddress)}</td>
      <td>{formatInteger(swap.inputAmountAtomic)}</td>
      <td>{formatInteger(swap.outputAmountAtomic)}</td>
      <td>
        {swap.walletorFeeAtomic ? formatInteger(swap.walletorFeeAtomic) : "—"}
      </td>
      <td>
        {swap.prizePoolContributionMicroUsd
          ? formatMoney(swap.prizePoolContributionMicroUsd, 6)
          : "—"}
      </td>
      <td>
        {swap.transactionHash ? (
          <a
            className="admin-wallet-link"
            href={`https://solscan.io/tx/${swap.transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            {formatDateTime(swap.createdAt)}
            <ArrowUpRight aria-hidden="true" />
          </a>
        ) : (
          formatDateTime(swap.createdAt)
        )}
      </td>
    </tr>
  );
}

function SiteControls({
  initialSettings,
  isPending,
  isSuccess,
  error,
  onSave,
}: {
  initialSettings: AdminRuntimeSettings;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  onSave: (settings: AdminRuntimeSettingsInput) => void;
}) {
  const [settings, setSettings] = useState<AdminRuntimeSettingsInput>(() =>
    toSettingsInput(initialSettings),
  );
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(settings);
  };
  return (
    <form className="admin-settings-form" onSubmit={submit}>
      <label className="admin-toggle">
        <input
          type="checkbox"
          checked={settings.announcementEnabled}
          onChange={(event) => {
            setSettings((current) => ({
              ...current,
              announcementEnabled: event.target.checked,
            }));
          }}
        />
        <span>Enable site announcement</span>
      </label>
      <TextField
        label="Announcement text"
        value={textValue(settings.announcementText)}
        maxLength={180}
        onChange={(value) => {
          setSettings((current) => ({
            ...current,
            announcementText: value,
          }));
        }}
      />
      <div className="admin-form-grid">
        <TextField
          label="Support email"
          type="email"
          value={textValue(settings.supportEmail)}
          onChange={(value) => {
            setSettings((current) => ({ ...current, supportEmail: value }));
          }}
        />
        <TextField
          label="Docs URL"
          type="url"
          value={textValue(settings.docsUrl)}
          onChange={(value) => {
            setSettings((current) => ({ ...current, docsUrl: value }));
          }}
        />
        <TextField
          label="X URL"
          type="url"
          value={textValue(settings.xUrl)}
          onChange={(value) => {
            setSettings((current) => ({ ...current, xUrl: value }));
          }}
        />
        <TextField
          label="Telegram URL"
          type="url"
          value={textValue(settings.telegramUrl)}
          onChange={(value) => {
            setSettings((current) => ({ ...current, telegramUrl: value }));
          }}
        />
        <TextField
          label="Discord URL"
          type="url"
          value={textValue(settings.discordUrl)}
          onChange={(value) => {
            setSettings((current) => ({ ...current, discordUrl: value }));
          }}
        />
      </div>
      <div className="admin-form-actions">
        <p>
          Fee policy, treasury controls, balances, rewards, and claims cannot be
          edited here.
        </p>
        <button
          className="admin-primary-button"
          type="submit"
          disabled={isPending}
        >
          <Save aria-hidden="true" />
          {isPending ? "Saving…" : "Save controls"}
        </button>
      </div>
      {isSuccess ? (
        <p className="admin-form-message is-success" role="status">
          Controls saved and audit logged.
        </p>
      ) : null}
      {error ? (
        <p className="admin-form-message is-error" role="alert">
          {error.message}
        </p>
      ) : null}
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "url";
  maxLength?: number;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function toSettingsInput(
  settings: AdminRuntimeSettings,
): AdminRuntimeSettingsInput {
  return {
    announcementEnabled: settings.announcementEnabled,
    announcementText: settings.announcementText,
    supportEmail: settings.supportEmail ?? "",
    docsUrl: settings.docsUrl ?? "",
    xUrl: settings.xUrl ?? "",
    telegramUrl: settings.telegramUrl ?? "",
    discordUrl: settings.discordUrl ?? "",
  };
}

function textValue(value: string | null | undefined): string {
  return value ?? "";
}

function formatInteger(value: string | number): string {
  return BigInt(value).toLocaleString("en-US");
}

function formatMoney(value: string, scale: number): string {
  const units = BigInt(value);
  const divisor = 10n ** BigInt(scale);
  const whole = units / divisor;
  const fraction = (units % divisor)
    .toString()
    .padStart(scale, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `$${whole.toLocaleString("en-US")}.${fraction}`;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function humanizeAction(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function readErrorDetails(
  payload: unknown,
): { code: string; message: string } | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload)
  ) {
    return null;
  }
  const error = payload.error;
  if (typeof error !== "object" || error === null) return null;
  if (!("code" in error) || !("message" in error)) return null;
  return typeof error.code === "string" && typeof error.message === "string"
    ? { code: error.code, message: error.message }
    : null;
}
