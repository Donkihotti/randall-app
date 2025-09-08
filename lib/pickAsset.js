// src/lib/pickAsset.js
/**
 * pickAssetUrl(asset)
 * Return the best client-usable URL for an asset row returned from the server.
 * Prefer, in order:
 *   1. signedUrl (added by server / status endpoint enrichment)
 *   2. url (db-stored signed url or canonical url)
 *   3. object_path / objectPath (we can't sign here, but return it as a safe fallback string)
 *   4. If asset is a plain string, return it
 *
 * This helper returns null when no usable url is found.
 */
export function pickAssetUrl(asset) {
    if (!asset) return null;
    if (typeof asset === "string") return asset;
    // Some records use different casing / names
    const signed = asset.signedUrl || asset.signed_url || asset.signedURL;
    if (signed) return signed;
    const url = asset.url || asset.href || asset.download_url;
    if (url) return url;
    const op = asset.object_path || asset.objectPath || asset.path || asset.object;
    if (op) {
      // keep as-is; calling code can decide to create a signed url via API if necessary
      return op;
    }
    return null;
  }
  
  // also provide default export for convenience/compat
  export default pickAssetUrl;
  