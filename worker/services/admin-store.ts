import {
  AdminAuditEventSchema,
  AdminD1SummarySchema,
  AdminRuntimeSettingsInputSchema,
  AdminRuntimeSettingsSchema,
  type AdminAuditEvent,
  type AdminD1Summary,
  type AdminRuntimeSettings,
  type AdminRuntimeSettingsInput,
} from "../../shared/admin-contracts";
import {
  UsdcClaimDistributionAdminResultSchema,
  type UsdcClaimDistributionAdminResult,
} from "../../shared/usdc-claim-contracts";

const SETTINGS_KEY = "admin:site-controls";

const DEFAULT_SETTINGS: AdminRuntimeSettings = {
  announcementEnabled: false,
  announcementText: "",
  supportEmail: null,
  docsUrl: "https://docs.walletor.com",
  xUrl: "https://x.com/walletorapp",
  telegramUrl: null,
  discordUrl: "https://discord.gg/hUCrahcEZK",
  updatedAt: null,
  updatedBy: null,
};

interface SettingRow {
  setting_value: string;
  updated_at: string;
  updated_by: string;
}

interface LastIndexedTokenRow {
  updated_at: string;
}

interface AuditRow {
  audit_log_id: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details_json: string;
  created_at: string;
}

interface ClaimDistributionSummaryRow {
  round_id: string;
  status: "STAGED" | "ACTIVE";
  manifest_checksum: string;
  distribution_address: string;
  net_distribution_amount_atomic: string;
  entitlement_count: number;
}

interface AdminAuditEventInput {
  requestId: string;
  roundId: string | null;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
}

function parseDetails(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  const record = AdminAuditEventSchema.shape.details.safeParse(parsed);
  return record.success ? record.data : {};
}

export async function getAdminRuntimeSettings(
  db: D1Database,
): Promise<AdminRuntimeSettings> {
  const row = await db
    .prepare(
      `SELECT setting_value, updated_at, updated_by
       FROM system_settings WHERE setting_key = ?`,
    )
    .bind(SETTINGS_KEY)
    .first<SettingRow>();
  if (!row) return DEFAULT_SETTINGS;
  const input: unknown = JSON.parse(row.setting_value);
  const parsed = AdminRuntimeSettingsInputSchema.safeParse(input);
  if (!parsed.success) return DEFAULT_SETTINGS;
  return AdminRuntimeSettingsSchema.parse({
    ...parsed.data,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  });
}

export async function updateAdminRuntimeSettings(
  db: D1Database,
  rawInput: AdminRuntimeSettingsInput,
  actorEmail: string,
  requestId: string,
  now = new Date(),
): Promise<AdminRuntimeSettings> {
  const input = AdminRuntimeSettingsInputSchema.parse(rawInput);
  const previous = await getAdminRuntimeSettings(db);
  const updatedAt = now.toISOString();
  const settingsValue = {
    announcementEnabled: input.announcementEnabled,
    announcementText: input.announcementText,
    supportEmail: input.supportEmail,
    docsUrl: input.docsUrl,
    xUrl: input.xUrl,
    telegramUrl: input.telegramUrl,
    discordUrl: input.discordUrl,
  };
  const auditId = crypto.randomUUID();

  await db.batch([
    db
      .prepare(
        `INSERT INTO system_settings (
          setting_key, setting_value, value_type, public, updated_at, updated_by
        ) VALUES (?, ?, 'JSON', 0, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          value_type = excluded.value_type,
          public = excluded.public,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by`,
      )
      .bind(SETTINGS_KEY, JSON.stringify(settingsValue), updatedAt, actorEmail),
    db
      .prepare(
        `INSERT INTO audit_logs (
          audit_log_id, request_id, round_id, chain_id, wallet_address,
          action, entity_type, entity_id, actor_type, details_json, created_at
        ) VALUES (?, ?, NULL, NULL, NULL, 'UPDATE_RUNTIME_SETTINGS',
          'SYSTEM_SETTINGS', ?, 'ADMIN', ?, ?)`,
      )
      .bind(
        auditId,
        requestId,
        SETTINGS_KEY,
        JSON.stringify({ before: previous, after: settingsValue, actorEmail }),
        updatedAt,
      ),
  ]);

  return AdminRuntimeSettingsSchema.parse({
    ...settingsValue,
    updatedAt,
    updatedBy: actorEmail,
  });
}

export async function getAdminD1Summary(
  accountingDb: D1Database,
  tokenDb?: D1Database,
): Promise<AdminD1Summary> {
  const discoveryDb = tokenDb ?? accountingDb;
  const discoveryTable = tokenDb ? "token_search_index" : "discovered_tokens";
  const [tokens, pumpfun, referral, pendingReferral, lastToken] =
    await Promise.all([
      discoveryDb
        .prepare(`SELECT COUNT(*) AS count FROM ${discoveryTable}`)
        .first<{ count: number }>(),
      discoveryDb
        .prepare(
          `SELECT COUNT(*) AS count FROM ${discoveryTable} WHERE source = 'pumpfun'`,
        )
        .first<{ count: number }>(),
      accountingDb
        .prepare("SELECT COUNT(*) AS count FROM referral_fee_mints")
        .first<{ count: number }>(),
      accountingDb
        .prepare(
          "SELECT COUNT(*) AS count FROM referral_fee_mints WHERE status = 'PENDING'",
        )
        .first<{ count: number }>(),
      discoveryDb
        .prepare(
          `SELECT updated_at FROM ${discoveryTable} ORDER BY updated_at DESC LIMIT 1`,
        )
        .first<LastIndexedTokenRow>(),
    ]);
  return AdminD1SummarySchema.parse({
    databaseName: tokenDb ? "walletor-token-index" : "walletor-accounting",
    discoveredTokenCount: tokens?.count ?? 0,
    pumpfunTokenCount: pumpfun?.count ?? 0,
    referralFeeMintCount: referral?.count ?? 0,
    pendingReferralFeeMintCount: pendingReferral?.count ?? 0,
    lastTokenIndexedAt: lastToken?.updated_at ?? null,
  });
}

export async function listAdminClaimDistributions(
  db: D1Database,
  limit = -1,
): Promise<UsdcClaimDistributionAdminResult[]> {
  const rows = await db
    .prepare(
      `SELECT d.round_id, d.status, d.manifest_checksum,
        d.distribution_address, d.net_distribution_amount_atomic,
        COUNT(e.entitlement_id) AS entitlement_count
       FROM usdc_claim_distributions AS d
       INNER JOIN usdc_claim_entitlements AS e ON e.round_id = d.round_id
       WHERE d.status IN ('STAGED', 'ACTIVE')
       GROUP BY d.round_id, d.status, d.manifest_checksum,
        d.distribution_address, d.net_distribution_amount_atomic, d.staged_at
       ORDER BY d.staged_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<ClaimDistributionSummaryRow>();
  return rows.results.map((row) =>
    UsdcClaimDistributionAdminResultSchema.parse({
      roundId: row.round_id,
      status: row.status,
      manifestChecksum: row.manifest_checksum,
      distributionAddress: row.distribution_address,
      netDistributionAmountAtomic: row.net_distribution_amount_atomic,
      entitlementCount: row.entitlement_count,
    }),
  );
}

export async function listAdminAuditEvents(
  db: D1Database,
  limit = 25,
): Promise<AdminAuditEvent[]> {
  const rows = await db
    .prepare(
      `SELECT audit_log_id,
        json_extract(details_json, '$.actorEmail') AS actor_email,
        action, entity_type, entity_id, details_json, created_at
       FROM audit_logs
       WHERE actor_type = 'ADMIN'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<AuditRow>();
  return rows.results.flatMap((row) => {
    const parsed = AdminAuditEventSchema.safeParse({
      id: row.audit_log_id,
      actorEmail: row.actor_email,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: parseDetails(row.details_json),
      createdAt: row.created_at,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export async function recordAdminAuditEvent(
  db: D1Database,
  input: AdminAuditEventInput,
  now = new Date(),
): Promise<void> {
  const createdAt = now.toISOString();
  await db
    .prepare(
      `INSERT INTO audit_logs (
        audit_log_id, request_id, round_id, chain_id, wallet_address,
        action, entity_type, entity_id, actor_type, details_json, created_at
      ) VALUES (?, ?, ?, 'solana-mainnet', NULL, ?, ?, ?, 'ADMIN', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.requestId,
      input.roundId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify({ ...input.details, actorEmail: input.actorEmail }),
      createdAt,
    )
    .run();
}
