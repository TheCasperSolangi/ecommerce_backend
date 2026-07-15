const Product = require('../models/Products');

/**
 * Snapshot cart line items with human-readable product names for orders/invoices.
 * Preserves existing product_name when already present (e.g. enriched cart lines).
 */
async function enrichCartItems(items = []) {
  const lines = Array.isArray(items) ? items : [];

  return Promise.all(
    lines.map(async (raw) => {
      const item = raw?.toObject ? raw.toObject() : { ...raw };
      const sku = String(item.product_sku || '').toUpperCase();
      let product_name = typeof item.product_name === 'string' ? item.product_name.trim() : '';
      let variant_label =
        typeof item.variant_label === 'string' ? item.variant_label.trim() : '';

      if (!product_name && sku) {
        const product = await Product.findOne({ 'variants.sku': sku }).select('name variants');
        if (product) {
          product_name = product.name || sku;
          if (!variant_label && typeof product.getVariantBySku === 'function') {
            const variant = product.getVariantBySku(sku);
            if (variant?.attributes) {
              const attrs =
                variant.attributes instanceof Map
                  ? Object.fromEntries(variant.attributes)
                  : variant.attributes;
              variant_label = Object.values(attrs || {})
                .filter(Boolean)
                .join(' / ');
            }
          }
        }
      }

      return {
        product_sku: sku || item.product_sku,
        product_name: product_name || sku || 'Item',
        variant_label: variant_label || '',
        quantity: item.quantity,
        price: item.price,
      };
    })
  );
}

module.exports = enrichCartItems;
