import {
  BadRequestException,
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
  revenueTarget: number | null;
}

export interface CampaignTargets {
  cpaTarget: number | null;
  roasTarget: number | null;
}

export interface TargetHistoryEntry {
  id: string;
  projectId: string;
  campaignId: string | null;
  targetType: 'cpa' | 'roas' | 'daily_spend' | 'revenue';
  oldValue: number | null;
  newValue: number | null;
  changedBy: string;
  changedAt: string;
  source: 'project_setup' | 'project_update' | 'campaign_override';
}

export interface ProjectRecord {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'archived' | 'deleted';
  adAccountIds: string[];
  products: string[];
  optimizationMethod: 'first_click_present' | 'first_click_absent';
  deviationThresholdPct: number;
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
      status: 'active' | 'paused' | 'archived' | 'deleted';
      optimization_method: 'first_click_present' | 'first_click_absent';
      deviation_threshold_pct: string | null;
      cpa_target: string | null;
      roas_target: string | null;
      daily_spend_target: string | null;
      revenue_target: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        SELECT DISTINCT
          p.id,
          p.name,
          p.status,
          p.optimization_method,
          p.deviation_threshold_pct,
          pt.cpa_target,
          pt.roas_target,
          pt.daily_spend_target,
          pt.revenue_target,
          p.created_at,
          p.updated_at
        FROM projects p
        LEFT JOIN project_targets pt ON p.id = pt.project_id
        LEFT JOIN project_ad_accounts paa
          ON p.id = paa.project_id
         AND paa.removed_at IS NULL
        WHERE ($1::text IS NULL OR paa.ad_account_id = $1)
          AND p.status <> 'deleted'
        ORDER BY p.updated_at DESC
      `,
      [adAccountId ?? null],
    );

    return Promise.all(result.rows.map((row) => this.hydrateProject(row)));
  }

  async create(payload: {
    name: string;
    adAccountIds: string[];
    products?: string[];
    optimizationMethod?: 'first_click_present' | 'first_click_absent';
    deviationThresholdPct?: number;
    targets?: Partial<ProjectTargets>;
    changedBy?: string;
  }) {
    const projectId = randomUUID();
    const now = new Date().toISOString();
    const normalizedAdAccountIds = [...new Set(payload.adAccountIds)];
    await this.assertNoActiveProjectAccountConflicts(normalizedAdAccountIds);

    await this.pool.query(
      `
        INSERT INTO projects (id, name, status, optimization_method, deviation_threshold_pct, created_at, updated_at)
        VALUES ($1, $2, 'active', $3, $4, $5, $6)
      `,
      [
        projectId,
        payload.name,
        payload.optimizationMethod ?? 'first_click_absent',
        payload.deviationThresholdPct ?? 10,
        now,
        now,
      ],
    );

    for (const adAccountId of normalizedAdAccountIds) {
      await this.pool.query(
        `
          INSERT INTO project_ad_accounts (
            id,
            project_id,
            ad_account_id,
            created_at,
            added_at,
            removed_at,
            backfill_status
          )
          VALUES ($1, $2, $3, $4, $4, NULL, 'pending')
          ON CONFLICT (project_id, ad_account_id) DO UPDATE SET
            removed_at = NULL,
            added_at = EXCLUDED.added_at,
            backfill_status = 'pending'
        `,
        [randomUUID(), projectId, adAccountId, now],
      );
    }

    const normalizedProducts = this.normalizeProducts(payload.products ?? []);
    for (const productName of normalizedProducts) {
      await this.pool.query(
        `
          INSERT INTO project_products (id, project_id, name, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (project_id, name) DO NOTHING
        `,
        [
          randomUUID(),
          projectId,
          productName,
          payload.changedBy ?? 'system',
          now,
          now,
        ],
      );
    }

    const next: ProjectTargets = {
      cpaTarget: payload.targets?.cpaTarget ?? null,
      roasTarget: payload.targets?.roasTarget ?? null,
      dailySpendTarget: payload.targets?.dailySpendTarget ?? null,
      revenueTarget: payload.targets?.revenueTarget ?? null,
    };
    await this.pool.query(
      `
        INSERT INTO project_targets (project_id, cpa_target, roas_target, daily_spend_target, revenue_target, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [projectId, next.cpaTarget, next.roasTarget, next.dailySpendTarget, next.revenueTarget, now],
    );

    await this.logProjectTargetChanges(
      projectId,
      { cpaTarget: null, roasTarget: null, dailySpendTarget: null, revenueTarget: null },
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
      status: 'active' | 'paused' | 'archived' | 'deleted';
      optimization_method: 'first_click_present' | 'first_click_absent';
      deviation_threshold_pct: string | null;
      cpa_target: string | null;
      roas_target: string | null;
      daily_spend_target: string | null;
      revenue_target: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        SELECT
          p.id,
          p.name,
          p.status,
          p.optimization_method,
          p.deviation_threshold_pct,
          pt.cpa_target,
          pt.roas_target,
          pt.daily_spend_target,
          pt.revenue_target,
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
      revenueTarget:
        changes.revenueTarget !== undefined
          ? changes.revenueTarget
          : previous.revenueTarget,
    };

    await this.pool.query(
      `
        INSERT INTO project_targets (project_id, cpa_target, roas_target, daily_spend_target, revenue_target, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (project_id) DO UPDATE SET
          cpa_target = EXCLUDED.cpa_target,
          roas_target = EXCLUDED.roas_target,
          daily_spend_target = EXCLUDED.daily_spend_target,
          revenue_target = EXCLUDED.revenue_target,
          updated_at = EXCLUDED.updated_at
      `,
      [
        projectId,
        next.cpaTarget,
        next.roasTarget,
        next.dailySpendTarget,
        next.revenueTarget,
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

  async updateSettings(
    projectId: string,
    changes: {
      optimizationMethod?: 'first_click_present' | 'first_click_absent';
      status?: 'active' | 'paused' | 'archived' | 'deleted';
      deviationThresholdPct?: number;
    },
  ) {
    const currentProject = await this.get(projectId);
    const now = new Date().toISOString();
    const nextStatus = changes.status ?? currentProject.status;
    if (!['active', 'paused', 'archived', 'deleted'].includes(nextStatus)) {
      throw new BadRequestException('Invalid project status.');
    }
    if (nextStatus === 'active' && currentProject.status !== 'active') {
      await this.assertNoActiveProjectAccountConflicts(
        currentProject.adAccountIds,
        projectId,
      );
    }
    await this.pool.query(
      `
        UPDATE projects
        SET optimization_method = COALESCE($2, optimization_method),
            status = COALESCE($3, status),
            deviation_threshold_pct = COALESCE($4, deviation_threshold_pct),
            updated_at = $5
        WHERE id = $1
      `,
      [
        projectId,
        changes.optimizationMethod ?? null,
        changes.status ?? null,
        changes.deviationThresholdPct ?? null,
        now,
      ],
    );
    return this.get(projectId);
  }

  async listTargetHistory(projectId: string) {
    const result = await this.pool.query<{
      id: string;
      project_id: string;
      campaign_id: string | null;
      target_type: 'cpa' | 'roas' | 'daily_spend' | 'revenue';
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
    const project = await this.get(projectId);
    const normalizedAdAccountIds = [...new Set(adAccountIds)];
    if (project.status === 'active') {
      await this.assertNoActiveProjectAccountConflicts(
        normalizedAdAccountIds,
        projectId,
      );
    }
    const now = new Date().toISOString();
    await this.pool.query(
      `
        UPDATE project_ad_accounts
        SET removed_at = $2
        WHERE project_id = $1
          AND ad_account_id <> ALL($3::text[])
          AND removed_at IS NULL
      `,
      [projectId, now, normalizedAdAccountIds],
    );

    for (const adAccountId of normalizedAdAccountIds) {
      await this.pool.query(
        `
          INSERT INTO project_ad_accounts (
            id,
            project_id,
            ad_account_id,
            created_at,
            added_at,
            removed_at,
            backfill_status
          )
          VALUES ($1, $2, $3, $4, $4, NULL, 'pending')
          ON CONFLICT (project_id, ad_account_id) DO UPDATE SET
            removed_at = NULL,
            added_at = EXCLUDED.added_at,
            backfill_status = CASE
              WHEN project_ad_accounts.backfill_status = 'completed'
                THEN project_ad_accounts.backfill_status
              ELSE 'pending'
            END
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

  async listProducts(projectId: string) {
    await this.assertProjectExists(projectId);
    const result = await this.pool.query<{ name: string }>(
      `
        SELECT name
        FROM project_products
        WHERE project_id = $1
        ORDER BY lower(name) ASC
      `,
      [projectId],
    );
    return result.rows.map((row) => row.name);
  }

  async replaceProducts(
    projectId: string,
    products: string[],
    changedBy = 'system',
  ) {
    await this.assertProjectExists(projectId);
    const next = this.normalizeProducts(products);
    await this.pool.query(
      `DELETE FROM project_products WHERE project_id = $1`,
      [projectId],
    );
    const now = new Date().toISOString();
    for (const productName of next) {
      await this.pool.query(
        `
          INSERT INTO project_products (id, project_id, name, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (project_id, name) DO NOTHING
        `,
        [randomUUID(), projectId, productName, changedBy, now, now],
      );
    }

    // Clear product tags that reference removed values.
    if (next.length > 0) {
      await this.pool.query(
        `
          DELETE FROM project_entity_tags
          WHERE project_id = $1
            AND category_key = 'product'
            AND value <> ALL($2::text[])
        `,
        [projectId, next],
      );
    } else {
      await this.pool.query(
        `
          DELETE FROM project_entity_tags
          WHERE project_id = $1
            AND category_key = 'product'
        `,
        [projectId],
      );
    }

    await this.pool.query(`UPDATE projects SET updated_at = $2 WHERE id = $1`, [
      projectId,
      now,
    ]);

    return this.listProducts(projectId);
  }

  async getTagCatalog(projectId: string) {
    const products = await this.listProducts(projectId);
    return TAG_CATALOG.map((category) => {
      if (category.key !== 'product') {
        return category;
      }
      return {
        ...category,
        values: products,
      };
    });
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
    product?: string | null;
  }) {
    const project = await this.get(payload.projectId);
    const useFirstClickRevenue =
      project.optimizationMethod === 'first_click_present';

    const adRows = await this.pool.query<{
      date: string;
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
      revenue_incremental: string;
      revenue_fc: string;
    }>(
      `
        SELECT
          ai.date,
          ac.ad_id,
          ac.adset_id,
          ac.campaign_id,
          ai.spend AS spend,
          ai.purchases AS purchases,
          ai.impressions AS impressions,
          ai.reach AS reach,
          ai.outbound_clicks AS outbound_clicks,
          ai.revenue_7d_click AS revenue_7d_click,
          ai.revenue_1d_view AS revenue_1d_view,
          ai.revenue_incremental AS revenue_incremental,
          ai.revenue_fc AS revenue_fc
        FROM ad_cache ac
        JOIN ad_insights_daily ai
          ON ai.account_id = ac.account_id
         AND ai.ad_id = ac.ad_id
        WHERE ac.account_id = $1
          AND ai.date BETWEEN $2 AND $3
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
    const groupedDaily = new Map<string, Map<string, { spend: number; revenue: number }>>();

    for (const row of adRows.rows) {
      if (payload.product) {
        const productValue =
          tagMap.get(`ad:${row.ad_id}:product`) ??
          tagMap.get(`adset:${row.adset_id}:product`) ??
          tagMap.get(`campaign:${row.campaign_id}:product`) ??
          'Untagged';
        if (productValue !== payload.product) {
          continue;
        }
      }

      const keyParts = payload.tagKeys.map((tagKey) => {
        return (
          tagMap.get(`ad:${row.ad_id}:${tagKey}`) ??
          tagMap.get(`adset:${row.adset_id}:${tagKey}`) ??
          tagMap.get(`campaign:${row.campaign_id}:${tagKey}`) ??
          'Untagged'
        );
      });
      const groupKey = keyParts.join(' / ');
      const blendedRevenue =
        this.toNumber(row.revenue_7d_click) + this.toNumber(row.revenue_1d_view);
      const revenueForMroas = useFirstClickRevenue
        ? this.toNumber(row.revenue_fc)
        : this.toNumber(row.revenue_incremental);
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
          current.revenue + blendedRevenue,
        reach: current.reach + this.toNumber(row.reach),
        impressions: current.impressions + this.toNumber(row.impressions),
        outboundClicks:
          current.outboundClicks + this.toNumber(row.outbound_clicks),
      });

      const currentDaily = groupedDaily.get(groupKey) ?? new Map();
      const bucket = currentDaily.get(row.date) ?? { spend: 0, revenue: 0 };
      currentDaily.set(row.date, {
        spend: bucket.spend + this.toNumber(row.spend),
        revenue: bucket.revenue + revenueForMroas,
      });
      groupedDaily.set(groupKey, currentDaily);
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
        mroas: (() => {
          const daily = groupedDaily.get(label);
          if (!daily) {
            return null;
          }
          const points = [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          const deltas: number[] = [];
          for (let index = 1; index < points.length; index += 1) {
            const currentPoint = points[index];
            const previousPoint = points[index - 1];
            if (!currentPoint || !previousPoint) {
              continue;
            }
            const deltaSpend = currentPoint[1].spend - previousPoint[1].spend;
            const deltaRevenue = currentPoint[1].revenue - previousPoint[1].revenue;
            if (Math.abs(deltaSpend) <= 0.01) {
              continue;
            }
            deltas.push(deltaRevenue / Math.abs(deltaSpend));
          }
          return this.median(deltas);
        })(),
      }))
      .sort((a, b) => b.spend - a.spend);

    return { rows };
  }

  private async hydrateProject(row: {
    id: string;
    name: string;
    status: 'active' | 'paused' | 'archived' | 'deleted';
    optimization_method: 'first_click_present' | 'first_click_absent';
    deviation_threshold_pct: string | null;
    cpa_target: string | null;
    roas_target: string | null;
    daily_spend_target: string | null;
    revenue_target: string | null;
    created_at: string;
    updated_at: string;
  }): Promise<ProjectRecord> {
    const adAccountsResult = await this.pool.query<{ ad_account_id: string }>(
      `
        SELECT ad_account_id
        FROM project_ad_accounts
        WHERE project_id = $1
          AND removed_at IS NULL
        ORDER BY COALESCE(added_at, created_at) ASC
      `,
      [row.id],
    );

    return {
      id: row.id,
      name: row.name,
      status: row.status ?? 'active',
      adAccountIds: adAccountsResult.rows.map((item) => item.ad_account_id),
      products: await this.listProducts(row.id),
      optimizationMethod: row.optimization_method ?? 'first_click_absent',
      deviationThresholdPct: this.toNullableNumber(row.deviation_threshold_pct) ?? 10,
      targets: {
        cpaTarget: this.toNullableNumber(row.cpa_target),
        roasTarget: this.toNullableNumber(row.roas_target),
        dailySpendTarget: this.toNullableNumber(row.daily_spend_target),
        revenueTarget: this.toNullableNumber(row.revenue_target),
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
    await this.logEntry(
      projectId,
      null,
      'revenue',
      previous.revenueTarget,
      next.revenueTarget,
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

  private median(values: number[]) {
    if (values.length < 3) {
      return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1]! + sorted[middle]!) / 2;
    }
    return sorted[middle] ?? null;
  }

  private normalizeProducts(products: string[]) {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const product of products) {
      const value = product.trim();
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push(value.slice(0, 100));
    }
    return normalized;
  }

  private async assertNoActiveProjectAccountConflicts(
    adAccountIds: string[],
    excludedProjectId?: string,
  ) {
    if (!adAccountIds.length) {
      return;
    }
    const result = await this.pool.query<{
      ad_account_id: string;
      project_name: string;
      project_id: string;
    }>(
      `
        SELECT paa.ad_account_id, p.name AS project_name, p.id AS project_id
        FROM project_ad_accounts paa
        JOIN projects p ON p.id = paa.project_id
        WHERE paa.ad_account_id = ANY($1::text[])
          AND paa.removed_at IS NULL
          AND p.status = 'active'
          AND ($2::text IS NULL OR p.id <> $2)
        ORDER BY p.updated_at DESC
      `,
      [adAccountIds, excludedProjectId ?? null],
    );

    if (!result.rows.length) {
      return;
    }

    const conflict = result.rows[0];
    throw new BadRequestException(
      `Ad account ${conflict?.ad_account_id} is already mapped to active project "${conflict?.project_name}" (${conflict?.project_id}).`,
    );
  }

  private async initSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        optimization_method TEXT NOT NULL DEFAULT 'first_click_absent',
        deviation_threshold_pct NUMERIC NOT NULL DEFAULT 10,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS optimization_method TEXT NOT NULL DEFAULT 'first_click_absent';
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS deviation_threshold_pct NUMERIC NOT NULL DEFAULT 10;

      CREATE TABLE IF NOT EXISTS project_ad_accounts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        ad_account_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        ad_account_name TEXT NULL,
        currency TEXT NULL,
        timezone TEXT NULL,
        added_at TIMESTAMPTZ NULL,
        removed_at TIMESTAMPTZ NULL,
        backfill_status TEXT NOT NULL DEFAULT 'pending',
        backfill_started_at TIMESTAMPTZ NULL,
        backfill_completed_at TIMESTAMPTZ NULL,
        last_sync_at TIMESTAMPTZ NULL,
        last_sync_status TEXT NULL,
        UNIQUE (project_id, ad_account_id)
      );

      ALTER TABLE project_ad_accounts
        ADD COLUMN IF NOT EXISTS ad_account_name TEXT NULL,
        ADD COLUMN IF NOT EXISTS currency TEXT NULL,
        ADD COLUMN IF NOT EXISTS timezone TEXT NULL,
        ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS backfill_status TEXT NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS backfill_started_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS backfill_completed_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS last_sync_status TEXT NULL;

      CREATE TABLE IF NOT EXISTS project_targets (
        project_id TEXT PRIMARY KEY,
        cpa_target NUMERIC NULL,
        roas_target NUMERIC NULL,
        daily_spend_target NUMERIC NULL,
        revenue_target NUMERIC NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      ALTER TABLE project_targets
        ADD COLUMN IF NOT EXISTS revenue_target NUMERIC NULL;

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

      CREATE TABLE IF NOT EXISTS project_products (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (project_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_project_products_project
      ON project_products (project_id, lower(name));
    `);
  }

  private async assertProjectExists(projectId: string) {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException('Project not found.');
    }
  }
}
