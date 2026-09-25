/* =============================================
   FOLIO — ENTITLEMENT SERVICE
   Single source of truth for plan + feature access.
   Frontend values are never trusted; everything here
   reads from PostgreSQL.
   ============================================= */

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

const PLAN_RANK = { journal: 0, chronicle: 1, heirloom: 2 };

// Centralized feature configuration (spec §18).
// `true`/`false` = boolean capability. Numbers = limits. Infinity = unlimited.
const PLAN_FEATURES = {
  journal: {
    unlimited_entries:    false,
    unlimited_characters: false,
    entries_per_day:      2,
    characters_per_entry: 1000,
    premium_themes:       false,
    animated_themes:      false,
    premium_fonts:        false,
    pdf_export:           false,
    custom_pdf_cover:     false,
    locked_entries:       0,
    advanced_statistics:  false,
    advanced_search:      false,
    marketplace:          'basic'
  },
  chronicle: {
    unlimited_entries:    true,
    unlimited_characters: true,
    entries_per_day:      Infinity,
    characters_per_entry: Infinity,
    premium_themes:       true,
    animated_themes:      false,
    premium_fonts:        true,
    pdf_export:           true,
    custom_pdf_cover:     false,
    locked_entries:       10,
    advanced_statistics:  true,
    advanced_search:      true,
    marketplace:          'full'
  },
  heirloom: {
    unlimited_entries:    true,
    unlimited_characters: true,
    entries_per_day:      Infinity,
    characters_per_entry: Infinity,
    premium_themes:       true,
    animated_themes:      true,
    premium_fonts:        true,
    pdf_export:           true,
    custom_pdf_cover:     true,
    locked_entries:       Infinity,
    advanced_statistics:  true,
    advanced_search:      true,
    marketplace:          'full'
  }
};

function createEntitlementService(pool) {

  // ─── Current plan ─────────────────────────────
  // No active row, or a period that has already ended → free Journal plan.
  // Also falls back to free plan (instead of throwing) if the subscriptions
  // table/columns are missing or malformed in the DB — a schema drift here
  // must never block core actions like saving an entry.
  async function getUserPlan(userId) {
    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT id, plan, status, billing_cycle,
                current_period_start, current_period_end, cancelled_at
         FROM subscriptions
         WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      ));
    } catch (err) {
      console.error('[entitlements] getUserPlan query failed, falling back to free plan:', err.message);
      return freePlan();
    }

    if (rows.length === 0) return freePlan();

    const sub = rows[0];

    // Lapsed period → flip to expired and fall back to Journal.
    if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
      await pool.query(
        `UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [sub.id]
      );
      return freePlan();
    }

    return {
      subscription_id:      sub.id,
      plan:                 sub.plan,
      status:               sub.status,
      billing_cycle:        sub.billing_cycle,
      current_period_start: sub.current_period_start,
      current_period_end:   sub.current_period_end,
      cancelled_at:         sub.cancelled_at
    };
  }

  function freePlan() {
    return {
      subscription_id:      null,
      plan:                 'journal',
      status:               'active',
      billing_cycle:        null,
      current_period_start: null,
      current_period_end:   null,
      cancelled_at:         null
    };
  }

  // ─── Feature helpers ──────────────────────────
  function featuresForPlan(plan) {
    return PLAN_FEATURES[plan] || PLAN_FEATURES.journal;
  }

  async function hasFeature(userId, feature) {
    const { plan } = await getUserPlan(userId);
    return !!featuresForPlan(plan)[feature];
  }

  async function getFeatureLimit(userId, feature) {
    const { plan } = await getUserPlan(userId);
    return featuresForPlan(plan)[feature];
  }

  function planAtLeast(plan, minPlan) {
    return PLAN_RANK[plan] >= PLAN_RANK[minPlan];
  }

  // ─── Entry creation limits ────────────────────
  async function canCreateEntry(userId, content) {
    const { plan } = await getUserPlan(userId);
    const features = featuresForPlan(plan);

    const charCheck = checkCharacterLimit(content, features);
    if (!charCheck.allowed) return charCheck;

    if (features.entries_per_day !== Infinity) {
      // Count is done in the app timezone so "today" matches the user's day.
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM entries
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND (created_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`,
        [userId, APP_TIMEZONE]
      );

      if (rows[0].count >= features.entries_per_day) {
        return {
          allowed: false,
          code: 'DAILY_LIMIT',
          message: `You've reached today's ${features.entries_per_day}-entry limit. Upgrade to Chronicle for unlimited entries.`
        };
      }
    }

    return { allowed: true };
  }

  // Editing does NOT consume a daily entry — only the character cap applies.
  async function canEditEntry(userId, content) {
    const { plan } = await getUserPlan(userId);
    return checkCharacterLimit(content, featuresForPlan(plan));
  }

  function checkCharacterLimit(content, features) {
    if (features.characters_per_entry === Infinity) return { allowed: true };
    const length = (content || '').length;
    if (length > features.characters_per_entry) {
      return {
        allowed: false,
        code: 'CHARACTER_LIMIT',
        message: `This entry exceeds the ${features.characters_per_entry.toLocaleString('en-IN')}-character limit on the Journal plan. Upgrade to Chronicle for unlimited writing.`
      };
    }
    return { allowed: true };
  }

  // ─── Locked entries limit ─────────────────────
  async function canLockEntry(userId, entryId) {
    const { plan } = await getUserPlan(userId);
    const limit = featuresForPlan(plan).locked_entries;

    if (limit === 0) {
      return {
        allowed: false,
        code: 'LOCKED_ENTRIES_UNAVAILABLE',
        message: 'Locked entries are included with Chronicle. Upgrade to keep entries behind a second password.'
      };
    }
    if (limit === Infinity) return { allowed: true };

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM entries
       WHERE user_id = $1 AND is_locked = TRUE AND deleted_at IS NULL
         AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, entryId || null]
    );

    if (rows[0].count >= limit) {
      return {
        allowed: false,
        code: 'LOCKED_ENTRIES_LIMIT',
        message: `You've locked ${limit} entries, the Chronicle limit. Upgrade to Heirloom for unlimited locked entries.`
      };
    }
    return { allowed: true };
  }

  // ─── Marketplace access ───────────────────────
  // Access = owned outright (permanent) OR included with the current plan.
  async function canAccessItem(userId, itemId) {
    const { rows: itemRows } = await pool.query(
      `SELECT id, slug, name, type, price, is_free, is_active, required_plan
       FROM marketplace_items WHERE id = $1`,
      [itemId]
    );
    if (itemRows.length === 0) return { access: false, reason: 'NOT_FOUND' };

    const item = itemRows[0];
    if (!item.is_active) return { access: false, reason: 'INACTIVE', item };

    const { rows: ownedRows } = await pool.query(
      `SELECT id FROM marketplace_purchases
       WHERE user_id = $1 AND item_id = $2 AND status = 'completed'`,
      [userId, itemId]
    );
    if (ownedRows.length > 0) return { access: true, reason: 'OWNED', item };

    if (item.is_free || Number(item.price) === 0) {
      return { access: true, reason: 'FREE', item };
    }

    if (item.required_plan) {
      const { plan } = await getUserPlan(userId);
      if (planAtLeast(plan, item.required_plan)) {
        return { access: true, reason: 'PLAN_INCLUDED', item };
      }
    }

    return { access: false, reason: 'NOT_OWNED', item };
  }

  async function getOwnedItems(userId) {
    const { rows } = await pool.query(
      `SELECT i.*, p.purchased_at
       FROM marketplace_purchases p
       JOIN marketplace_items i ON i.id = p.item_id
       WHERE p.user_id = $1 AND p.status = 'completed'
       ORDER BY p.purchased_at DESC`,
      [userId]
    );
    return rows;
  }

  return {
    PLAN_FEATURES,
    PLAN_RANK,
    getUserPlan,
    featuresForPlan,
    hasFeature,
    getFeatureLimit,
    planAtLeast,
    canCreateEntry,
    canEditEntry,
    canLockEntry,
    canAccessItem,
    getOwnedItems
  };
}

module.exports = { createEntitlementService, PLAN_FEATURES, PLAN_RANK };