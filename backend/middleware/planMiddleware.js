/* =============================================
   FOLIO — PLAN MIDDLEWARE
   Route guards built on the entitlement service.
   Runs after authenticateToken, so req.user.id exists.
   ============================================= */

function createPlanMiddleware(entitlements) {

  // requirePlan('chronicle') — minimum plan tier.
  function requirePlan(minPlan) {
    return async (req, res, next) => {
      try {
        const sub = await entitlements.getUserPlan(req.user.id);
        if (!entitlements.planAtLeast(sub.plan, minPlan)) {
          return res.status(403).json({
            success: false,
            message: `This feature is included with ${capitalize(minPlan)}.`,
            required_plan: minPlan,
            current_plan: sub.plan
          });
        }
        req.subscription = sub;
        next();
      } catch (err) {
        console.error('requirePlan error:', err.message);
        res.status(500).json({ success: false, message: 'Could not verify your plan.' });
      }
    };
  }

  // requireFeature('pdf_export') — boolean capability from PLAN_FEATURES.
  function requireFeature(feature) {
    return async (req, res, next) => {
      try {
        const sub = await entitlements.getUserPlan(req.user.id);
        const features = entitlements.featuresForPlan(sub.plan);

        if (!features[feature]) {
          return res.status(403).json({
            success: false,
            message: `${humanize(feature)} is included with a paid plan.`,
            feature,
            current_plan: sub.plan
          });
        }
        req.subscription = sub;
        next();
      } catch (err) {
        console.error('requireFeature error:', err.message);
        res.status(500).json({ success: false, message: 'Could not verify your plan.' });
      }
    };
  }

  // Attaches req.subscription without blocking — for routes that adapt
  // their response based on plan rather than refusing outright.
  function attachPlan() {
    return async (req, res, next) => {
      try {
        req.subscription = await entitlements.getUserPlan(req.user.id);
      } catch (err) {
        console.error('attachPlan error:', err.message);
        req.subscription = { plan: 'journal', status: 'active' };
      }
      next();
    };
  }

  return { requirePlan, requireFeature, attachPlan };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function humanize(feature) {
  return capitalize(String(feature).replace(/_/g, ' '));
}

module.exports = { createPlanMiddleware };
