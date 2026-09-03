const axios = require("axios");

const XARID_HOSTS = [
  "https://xarid-api-auctionx.uzex.uz",
  "https://xarid-api-shop.uzex.uz",
  "https://xarid-api-direct.uzex.uz",
  "https://xarid-api-national.uzex.uz"
];

/**
 * Extracts file metadata from xarid.uzex.uz (auctions, shop, direct, etc.)
 * @param {string|number} lotId 
 * @returns {Promise<Array<{name: string, path: string, type: string}>>}
 */
async function extractXaridFiles(lotId) {
  if (!lotId) return [];

  for (const host of XARID_HOSTS) {
    try {
      const lotApiUrl = `${host}/api/Lot/Get?id=${lotId}`;
      const response = await axios.get(lotApiUrl, {
        timeout: 6000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Origin": "https://xarid.uzex.uz",
          "Referer": "https://xarid.uzex.uz/",
          "Accept": "application/json, text/plain, */*"
        }
      });

      const data = response.data;
      const lotData = data?.Data || data;
      if (lotData && Array.isArray(lotData.files) && lotData.files.length > 0) {
        const files = [];
        for (const f of lotData.files) {
          if (!f) continue;
          const fileName = f.customName || f.name || `file_${f.id || lotId}`;
          const filePath = f.path ? `${f.path}/${f.name || ''}` : f.name;

          if (filePath) {
            files.push({
              name: fileName,
              path: filePath,
              ext: f.ext,
              fileSize: f.fileSize,
              type: "etender_download_path"
            });
          }
        }
        if (files.length > 0) return files;
      }
    } catch (error) {
      // try next xarid host
    }
  }

  return [];
}

module.exports = { extractXaridFiles };
