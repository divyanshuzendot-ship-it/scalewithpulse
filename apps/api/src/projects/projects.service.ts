import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export interface ProjectTargets {
  cpaTarget: number | null;
  roasTarget: number | null;
  dailySpendTarget: number | null;
}

export interface CampaignTargets {
  cpaTarget: number | null;
  roasTarget: number | null;
}

export interface TargetHistoryEntry {
  id: string;
  projectId: string;
  campaignId: string | null;
  targetType: 'cpa' | 'roas' | 'daily_spend';
  oldValue: number | null;
  newValue: number | null;
  changedBy: string;
  changedAt: string;
  source: 'project_setup' | 'project_update' | 'campaign_override';
}

export interface ProjectRecord {
  id: string;
  name: string;
  adAccountIds: string[];
  targets: ProjectTargets;
  campaignTargets: Record<string, CampaignTargets>;
  createdAt: string;
  updatedAt: string;
}

type EntityType = 'campaign' | 'adset' | 'ad';

const TAG_CATALOG = [
  {
    key: 'buying_type',
    label: 'Buying Type',
    values: ['CBO', 'ABO'],
  },
  {
    key: 'creative_format',
    label: 'Creative Format',
    values: ['Video', 'Image', 'Carousel'],
  },
  {
    key: 'collaboration',
    label: 'Collaboration',
    values: ['Collab', 'Non-Collab'],
  },
  {
    key: 'page_type',
    label: 'Page Type',
    values: ['Brand Page', 'Non-Brand Page'],
  },
  {
    key: 'attribution',
    label: 'Attribution',
    values: ['Incremental', '7-Day Click', '1-Day Click'],
  },
  {
    key: 'content_type',
    label: 'Content Type',
    values: ['UGC', 'Non-UGC'],
  },
  {
    key: 'offer_status',
    label: 'Offer Status',
    values: ['Offer', 'BAU'],
  },
  {
    key: 'product',
    label: 'Product',
    values: [],
  },
] as const;

@Injectable()
export class ProjectsService implements OnModuleInit, OnModuleDestroy {
  private static resolveDatabaseUrl() {
    const value = process.env.DATABASE_URL;
    if (!value) {
      throw new Error(
        'DATABASE_URL is required for ProjectsService. Set it in apps/api/.env (example: postgresql://<user>:<password>@localhost:5432/scalewithpulse).',
      );
    }
    return value;
  }

  private readonly pool = new Pool({
    connectionString: ProjectsService.resolveDatabaseUrl(),
  });

  async onModuleInit() {
    await this.initSchema();
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async list(adAccountId?: string) {
    const result = await this.pool.query<{
      id: string;
      name: string;
      cpa_target: string | null;
      roas_target: string | null;
      daily_spend_target: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        SELECT DISTINCT
          p.id,
          p.name,
          pt.cpa_target,
          pt.roas_target,
          pt.daily_spend_target,
          p.created_at,
          p.updated_at
        FROM projects p
        LEFT JOIN project_targets pt ON p.id = pt.project_id
        LEFT JOIN project_ad_accounts paa ON p.id = paa.project_id
        WHERE ($1::text IS NULL OR paa.ad_account_id = $1)
        ORDER BY p.updated_at DESC
      `,
      [adAccountId ?? null],
    );

    return Promise.all(result.rows.map((row) => this.hydrateProject(row)));
  }

  async create(payload: {
    name: string;
    adAccountIds: string[];
    targets?: Partial<ProjectTargets>;
    changedBy?: string;
  }) {
    const projectId = randomUUID();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)`,
      [projectId, payload.name, now, now],
    );

    for (const adAccountId of payload.adAccountIds) {
      await this.pool.query(
        `
          INSERT INTO project_ad_accounts (id, project_id, ad_account_id, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (project_id, ad_account_id) DO NOTHING
        `,
        [randomUUID(), projectId, adAccountId, now],
      );
    }

    const next: ProjectTargets = {
      cpaTarget: payload.targets?.cpaTarget ?? null,
      roasTarget: payload.targets?.roasTarget ?? null,
      dailySpendTarget: payload.targets?.dailySpendTarget ?? null,
    };
    await this.pool.query(
      `
        INSERT INTO project_targets (project_id, cpa_target, roas_target, daily_spend_target, updated_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [projectId, next.cpaTarget, next.roasTarget, next.dailySpendTarget, now],
    );

    await this.logProjectTargetChanges(
      projectId,
      { cpaTarget: null, roasTarget: null, dailySpendTarget: null },
      next,
      payload.changedBy ?? 'system',
      'project_setup',
    );

    return this.get(projectId);
  }

  async get(projectId: string) {
    const result = await this.pool.query<{
      id: string;
      name: string;
      cpa_target: string | null;
      roas_target: string | null;
      daily_spend_target: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        SELECT
          p.id,
          p.name,
          pt.cpa_target,
          pt.roas_target,
          pt.daily_spend_target,
          p.created_at,
          p.updated_at
        FROM projects p
        LEFT JOIN project_targets pt ON p.id = pt.project_id
        WHERE p.id = $1
      `,
      [projectId],
    );

    if (!result.rows[0]) {
      throw new NotFoundException('Project not found.');
    }

    return this.hydrateProject(result.rows[0]);
  }

  async updateTargets(
    projectId: string,
    changes: Partial<ProjectTargets>,
    changedBy = 'system',
  ) {
    const project = await this.get(projectId);
    const previous = { ...project.targets };
    const next: ProjectTargets = {
      cpaTarget:
        changes.cpaTarget !== undefined
          ? changes.cpaTarget
          : previous.cpaTarget,
      roasTarget:
        changes.roasTarget !== undefined
          ? changes.roasTarget
          : previous.roasTarget,
      dailySpendTarget:
        changes.dailySpendTarget !== undefined
          ? changes.dailySpendTarget
          : previous.dailySpendTarget,
    };

    await this.pool.query(
      `
        INSERT INTO project_targets (project_id, cpa_target, roas_target, daily_spend_target, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (project_id) DO UPDATE SET
          cpa_target = EXCLUDED.cpa_target,
          roas_target = EXCLUDED.roas_target,
          daily_spend_target = EXCLUDED.daily_spend_target,
          updated_at = EXCLUDED.updated_at
      `,
      [
        projectId,
        next.cpaTarget,
        next.roasTarget,
        next.dailySpendTarget,
        new Date().toISOString(),
      ],
    );
    await this.pool.query(`UPDATE projects SET updated_at = $2 WHERE id = $1`, [
      projectId,
      new Date().toISOString(),
    ]);

    await this.logProjectTargetChanges(
      projectId,
      previous,
      next,
      changedBy,
      'project_update',
    );

    return this.get(projectId);
  }

  async listTargetHistory(projectId: string) {
    const result = await this.pool.query<{
      id: string;
      project_id: string;
      campaign_id: string | null;
      target_type: 'cpa' | 'roas' | 'daily_spend';
      old_value: string | null;
      new_value: string | null;
      changed_by: string;
      changed_at: string;
      source: 'project_setup' | 'project_update' | 'campaign_override';
    }>(
      `
        SELECT id, project_id, campaign_id, target_type, old_value, new_value, changed_by, changed_at, source
        FROM target_history
        WHERE project_id = $1
        ORDER BY changed_at DESC
      `,
      [projectId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      campaignId: row.campaign_id,
      targetType: row.target_type,
      oldValue: this.toNullableNumber(row.old_value),
      newValue: this.toNullableNumber(row.new_value),
      changedBy: row.changed_by,
      changedAt: row.changed_at,
      source: row.source,
    }));
  }

  async listCampaignTargets(projectId: string) {
    await this.get(projectId);
    return this.loadCampaignTargets(projectId);
  }

  async upsertCampaignTargets(
    projectId: string,
    campaignId: string,
    changes: Partial<CampaignTargets>,
    changedBy = 'system',
  ) {
    await this.get(projectId);

    const existingResult = await this.pool.query<{
      cpa_target: string | null;
      roas_target: string | null;
    }>(
      `
        SELECT cpa_target, roas_target
        FROM campaign_targets
        WHERE project_id = $1 AND campaign_id = $2
      `,
      [projectId, campaignId],
    );

    const existing = existingResult.rows[0];
    const previous: CampaignTargets = {
      cpaTarget: this.toNullableNumber(existing?.cpa_target ?? null),
      roasTarget: this.toNullableNumber(existing?.roas_target ?? null),
    };
    const next: CampaignTargets = {
      cpaTarget:
        changes.cpaTarget !== undefined
          ? changes.cpaTarget
          : previous.cpaTarget,
      roasTarget:
        changes.roasTarget !== undefined
          ? changes.roasTarget
          : previous.roasTarget,
    };

    await this.pool.query(
      `
        INSERT INTO campaign_targets (project_id, campaign_id, cpa_target, roas_target, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (project_id, campaign_id) DO UPDATE SET
          cpa_target = EXCLUDED.cpa_target,
          roas_target = EXCLUDED.roas_target,
          updated_at = EXCLUDED.updated_at
      `,
      [
        projectId,
        campaignId,
        next.cpaTarget,
        next.roasTarget,
        new Date().toISOString(),
      ],
    );
    await this.pool.query(`UPDATE projects SET updated_at = $2 WHERE id = $1`, [
      projectId,
      new Date().toISOString(),
    ]);

    await this.logCampaignTargetChange(
      projectId,
      campaignId,
      'cpa',
      previous.cpaTarget,
      next.cpaTarget,
      changedBy,
    );
    await this.logCampaignTargetChange(
      projectId,
      campaignId,
      'roas',
      previous.roasTarget,
      next.roasTarget,
      changedBy,
    );

    return next;
  }

  async replaceProjectAdAccounts(projectId: string, adAccountIds: string[]) {
    await this.get(projectId);
    await this.pool.query(
      `DELETE FROM project_ad_accounts WHERE project_id = $1`,
      [projectId],
    );

    const now = new Date().toISOString();
    for (const adAccountId of adAccountIds) {
      await this.pool.query(
        `
          INSERT INTO project_ad_accounts (id, project_id, ad_account_id, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (project_id, ad_account_id) DO NOTHING
        `,
        [randomUUID(), projectId, adAccountId, now],
      );
    }

    await this.pool.query(`UPDATE projects SET updated_at = $2 WHERE id = $1`, [
      projectId,
      now,
    ]);

    return this.get(projectId);
  }

  getTagCatalog() {
    return TAG_CATALOG;
  }

  async listEntityTags(projectId: string, accountId: string) {
    await this.get(projectId);
    const result = await this.pool.query<{
      entity_type: EntityType;
      entity_id: string;
      category_key: string;
      value: string;
      is_auto: boolean;
      updated_by: string;
      updated_at: string;
    }>(
      `
        SELECT entity_type, entity_id, category_key, value, is_auto, updated_by, updated_at
        FROM project_entity_tags
        WHERE project_id = $1 AND account_id = $2
        ORDER BY updated_at DESC
      `,
      [projectId, accountId],
    );

    return result.rows;
  }

  async upsertEntityTag(payload: {
    projectId: string;
    accountId: string;
    entityType: EntityType;
    entityId: string;
    categoryKey: string;
    value: string | null;
    changedBy?: string;
  }) {
    await this.get(payload.projectId);

    if (payload.value === null || payload.value === '') {
      await this.pool.query(
        `
          DELETE FROM project_entity_tags
          WHERE project_id = $1
            AND account_id = $2
            AND entity_type = $3
            AND entity_id = $4
            AND category_key = $5
        `,
        [
          payload.projectId,
          payload.accountId,
          payload.entityType,
          payload.entityId,
          payload.categoryKey,
        ],
      );
      return { success: true };
    }

    await this.pool.query(
      `
        INSERT INTO project_entity_tags (
          id, project_id, account_id, entity_type, entity_id, category_key, value, is_auto, updated_by, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,false,$8,NOW()
        )
        ON CONFLICT (project_id, account_id, entity_type, entity_id, category_key) DO UPDATE SET
          value = EXCLUDED.value,
          is_auto = false,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      `,
      [
        randomUUID(),
        payload.projectId,
        payload.accountId,
        payload.entityType,
        payload.entityId,
        payload.categoryKey,
        payload.value,
        payload.changedBy ?? 'system',
      ],
    );

    return { success: true };
  }

  async buildCustomBreakdown(payload: {
    projectId: string;
    accountId: string;
    since: string;
    until: string;
    tagKeys: string[];
  }) {
    await this.get(payload.projectId);

    const adRows = await this.pool.query<{
      ad_id: string;
      adset_id: string;
      campaign_id: string;
      spend: string;
      purchases: string;
      impressions: string;
      reach: string;
      outbound_clicks: string;
      revenue_7d_click: string;
      revenue_1d_view: string;
    }>(
      `
        SELECT
          ac.ad_id,
          ac.adset_id,
          ac.campaign_id,
          ai.spend,
          ai.purchases,
          ai.impressions,
          ai.reach,
          ai.outbound_clicks,
          ai.revenue_7d_click,
          ai.revenue_1d_view
        FROM ad_cache ac
        JOIN ad_insights_range ai
          ON ai.account_id = ac.account_id
         AND ai.ad_id = ac.ad_id
        WHERE ac.account_id = $1
          AND ai.since = $2
          AND ai.until = $3
      `,
      [payload.accountId, payload.since, payload.until],
    );

    const tags = await this.listEntityTags(
      payload.projectId,
      payload.accountId,
    );
    const tagMap = new Map<string, string>();
    for (const tag of tags) {
      tagMap.set(
        `${tag.entity_type}:${tag.entity_id}:${tag.category_key}`,
        tag.value,
      );
    }

    const grouped = new Map<
      string,
      {
        spend: number;
        purchases: number;
        revenue: number;
        reach: number;
        impressions: number;
        outboundClicks: number;
      }
    >();

    for (const row of adRows.rows) {
      const keyParts = payload.tagKeys.map((tagKey) => {
        return (
          tagMap.get(`ad:${row.ad_id}:${tagKey}`) ??
          tagMap.get(`adset:${row.adset_id}:${tagKey}`) ??
          tagMap.get(`campaign:${row.campaign_id}:${tagKey}`) ??
          'Untagged'
        );
      });
      const groupKey = keyParts.join(' / ');
      const current = grouped.get(groupKey) ?? {
        spend: 0,
        purchases: 0,
        revenue: 0,
        reach: 0,
        impressions: 0,
        outboundClicks: 0,
      };
      grouped.set(groupKey, {
        spend: current.spend + this.toNumber(row.spend),
        purchases: current.purchases + this.toNumber(row.purchases),
        revenue:
          current.revenue +
          this.toNumber(row.revenue_7d_click) +
          this.toNumber(row.revenue_1d_view),
        reach: current.reach + this.toNumber(row.reach),
        impressions: current.impressions + this.toNumber(row.impressions),
        outboundClicks:
          current.outboundClicks + this.toNumber(row.outbound_clicks),
      });
    }

    const rows = [...grouped.entries()]
      .map(([label, values]) => ({
        label,
        spend: values.spend,
        cpa: values.purchases > 0 ? values.spend / values.purchases : null,
        roas: values.spend > 0 ? values.revenue / values.spend : null,
        cpir: values.reach > 0 ? (values.spend * 1000) / values.reach : null,
        impressions: values.impressions,
        reach: values.reach,
        conversionRate:
          values.outboundClicks > 0
            ? (values.purchases / values.outboundClicks) * 100
            : null,
      }))
      .sort((a, b) => b.spend - a.spend);

    return { rows };
  }

  private async hydrateProject(row: {
    id: string;
    name: string;
    cpa_target: string | null;
    roas_target: string | null;
    daily_spend_target: string | null;
    created_at: string;
    updated_at: string;
  }): Promise<ProjectRecord> {
    const adAccountsResult = await this.pool.query<{ ad_account_id: string }>(
      `
        SELECT ad_account_id
        FROM project_ad_accounts
        WHERE project_id = $1
        ORDER BY created_at ASC
      `,
      [row.id],
    );

    return {
      id: row.id,
      name: row.name,
      adAccountIds: adAccountsResult.rows.map((item) => item.ad_account_id),
      targets: {
        cpaTarget: this.toNullableNumber(row.cpa_target),
        roasTarget: this.toNullableNumber(row.roas_target),
        dailySpendTarget: this.toNullableNumber(row.daily_spend_target),
      },
      campaignTargets: await this.loadCampaignTargets(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async loadCampaignTargets(projectId: string) {
    const result = await this.pool.query<{
      campaign_id: string;
      cpa_target: string | null;
      roas_target: string | null;
    }>(
      `
        SELECT campaign_id, cpa_target, roas_target
        FROM campaign_targets
        WHERE project_id = $1
      `,
      [projectId],
    );

    const map: Record<string, CampaignTargets> = {};
    for (const row of result.rows) {
      map[row.campaign_id] = {
        cpaTarget: this.toNullableNumber(row.cpa_target),
        roasTarget: this.toNullableNumber(row.roas_target),
      };
    }

    return map;
  }

  private async logProjectTargetChanges(
    projectId: string,
    previous: ProjectTargets,
    next: ProjectTargets,
    changedBy: string,
    source: TargetHistoryEntry['source'],
  ) {
    await this.logEntry(
      projectId,
      null,
      'cpa',
      previous.cpaTarget,
      next.cpaTarget,
      changedBy,
      source,
    );
    await this.logEntry(
      projectId,
      null,
      'roas',
      previous.roasTarget,
      next.roasTarget,
      changedBy,
      source,
    );
    await this.logEntry(
      projectId,
      null,
      'daily_spend',
      previous.dailySpendTarget,
      next.dailySpendTarget,
      changedBy,
      source,
    );
  }

  private async logCampaignTargetChange(
    projectId: string,
    campaignId: string,
    type: 'cpa' | 'roas',
    oldValue: number | null,
    newValue: number | null,
    changedBy: string,
  ) {
    await this.logEntry(
      projectId,
      campaignId,
      type,
      oldValue,
      newValue,
      changedBy,
      'campaign_override',
    );
  }

  private async logEntry(
    projectId: string,
    campaignId: string | null,
    targetType: TargetHistoryEntry['targetType'],
    oldValue: number | null,
    newValue: number | null,
    changedBy: string,
    source: TargetHistoryEntry['source'],
  ) {
    if (oldValue === newValue) {
      return;
    }

    await this.pool.query(
      `
        INSERT INTO target_history (id, project_id, campaign_id, target_type, old_value, new_value, changed_by, changed_at, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        randomUUID(),
        projectId,
        campaignId,
        targetType,
        oldValue,
        newValue,
        changedBy,
        new Date().toISOString(),
        source,
      ],
    );
  }

  private toNullableNumber(value: string | null) {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toNumber(value: string | null | undefined) {
    if (value === null || value === undefined) {
      return 0;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async initSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_ad_accounts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        ad_account_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (project_id, ad_account_id)
      );

      CREATE TABLE IF NOT EXISTS project_targets (
        project_id TEXT PRIMARY KEY,
        cpa_target NUMERIC NULL,
        roas_target NUMERIC NULL,
        daily_spend_target NUMERIC NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS campaign_targets (
        project_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        cpa_target NUMERIC NULL,
        roas_target NUMERIC NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (project_id, campaign_id)
      );

      CREATE TABLE IF NOT EXISTS target_history (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        campaign_id TEXT NULL,
        target_type TEXT NOT NULL,
        old_value NUMERIC NULL,
        new_value NUMERIC NULL,
        changed_by TEXT NOT NULL,
        changed_at TIMESTAMPTZ NOT NULL,
        source TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_target_history_project_changed_at
      ON target_history (project_id, changed_at DESC);

      CREATE TABLE IF NOT EXISTS project_entity_tags (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        category_key TEXT NOT NULL,
        value TEXT NOT NULL,
        is_auto BOOLEAN NOT NULL DEFAULT false,
        updated_by TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (project_id, account_id, entity_type, entity_id, category_key)
      );

      CREATE INDEX IF NOT EXISTS idx_project_entity_tags_lookup
      ON project_entity_tags (project_id, account_id, category_key, entity_type, entity_id);
    `);
  }
}
