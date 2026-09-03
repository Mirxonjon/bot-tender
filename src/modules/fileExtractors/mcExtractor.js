const axios = require("axios");

/**
 * Extracts files from tender.mc.uz (Shaffof Qurilish)
 * @param {string|number} tenderId 
 * @returns {Promise<Array<{name: string, url: string, type: string}>>}
 */
async function extractMcFiles(tenderId) {
  try {
    const apiUrl = `https://apisitender.mc.uz/api/tenders/${tenderId}`;
    const response = await axios.get(apiUrl, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
      }
    });

    const data = response.data;
    const tender = data?.result?.data || data?.data || data;
    if (!tender) return [];

    const files = [];

    // Excel estimates / documents
    if (Array.isArray(tender.excels)) {
      for (const item of tender.excels) {
        if (item?.file) {
          const fileUrl = item.file.startsWith("http") ? item.file : `https://apisitender.mc.uz${item.file}`;
          files.push({
            name: item.name || `estimate_${tenderId}.xlsx`,
            url: fileUrl,
            type: "direct_url"
          });
        }
      }
    }

    // Direct files / documents
    if (Array.isArray(tender.files)) {
      for (const item of tender.files) {
        const path = item?.file || item?.path || item?.url;
        if (path) {
          const fileUrl = path.startsWith("http") ? path : `https://apisitender.mc.uz${path}`;
          files.push({
            name: item.name || `document_${tenderId}`,
            url: fileUrl,
            type: "direct_url"
          });
        }
      }
    }

    return files;
  } catch (error) {
    console.error(`[mcExtractor] Error extracting files for tender ${tenderId}:`, error.message);
    return [];
  }
}

module.exports = { extractMcFiles };
