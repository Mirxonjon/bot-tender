const axios = require("axios");

/**
 * Extracts files from xt-xarid.uz
 * @param {string|number} procedureId 
 * @returns {Promise<Array<{name: string, url: string, type: string}>>}
 */
async function extractXtXaridFiles(procedureId) {
  try {
    const id = parseInt(procedureId, 10) || procedureId;
    const refs = ["ref_selection_public", "ref_tender_public", "ref_online_shop_public", "ref_reduction_object_public"];
    const files = [];

    for (const ref of refs) {
      try {
        const response = await axios.post("https://api.test.xt-xarid.uz:8443/rpc", {
          id: 1,
          jsonrpc: "2.0",
          method: "ref",
          params: {
            ref,
            op: "read",
            filters: { id }
          }
        }, {
          timeout: 6000,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          }
        });

        const items = response.data?.result;
        if (Array.isArray(items) && items.length > 0) {
          const item = items[0];
          // Check for files or documents in metadata
          if (Array.isArray(item.files)) {
            for (const f of item.files) {
              const fileId = typeof f === 'object' ? (f.id || f.file_id) : f;
              if (fileId) {
                files.push({
                  name: (typeof f === 'object' && f.name) ? f.name : `doc_${fileId}.pdf`,
                  url: `https://api.test.xt-xarid.uz:8443/file/${fileId}`,
                  type: "direct_url"
                });
              }
            }
          }
          if (files.length > 0) break;
        }
      } catch (err) {
        // try next ref store
      }
    }

    return files;
  } catch (error) {
    console.error(`[xtXaridExtractor] Error extracting files for procedure ${procedureId}:`, error.message);
    return [];
  }
}

module.exports = { extractXtXaridFiles };
