const ApiError = require('../utils/ApiError');

/**
 * warehouseScope middleware
 * ─────────────────────────
 * Must run AFTER `authenticate` so req.user is populated.
 *
 * Behaviour:
 *  - Super-admin  (is_allowed_all_warehouse: true)
 *      → req.warehouseFilter = {}          (no restriction — sees everything)
 *      → req.warehouseId     = null
 *      → req.isSuperAdmin    = true
 *
 *  - Regular admin / rider / staff  (has warehouse_id)
 *      → req.warehouseFilter = { warehouse_id: <id> }
 *      → req.warehouseId     = <id>
 *      → req.isSuperAdmin    = false
 *
 *  - No warehouse assigned and not super-admin → 403
 *
 * Controllers use req.warehouseFilter to scope their DB queries and
 * req.warehouseId to stamp new documents.
 */
const warehouseScope = (req, res, next) => {
  const user = req.user;

  if (!user) {
    return next(new ApiError(401, 'Authentication required'));
  }

  if (user.is_allowed_all_warehouse) {
    // Super-admin: allow optional warehouse override via query/body.
    // e.g. ?warehouse_id=xxx to filter a specific warehouse's data.
    const override = req.query.warehouse_id || req.body.warehouse_id || null;
    req.warehouseFilter = override ? { warehouse_id: override } : {};
    req.warehouseId     = override || null;
    req.isSuperAdmin    = true;
    return next();
  }

  if (!user.warehouse_id) {
    return next(
      new ApiError(403, 'Your account is not assigned to any warehouse. Please contact an administrator.')
    );
  }

  req.warehouseFilter = { warehouse_id: user.warehouse_id };
  req.warehouseId     = user.warehouse_id;
  req.isSuperAdmin    = false;
  next();
};

module.exports = warehouseScope;
