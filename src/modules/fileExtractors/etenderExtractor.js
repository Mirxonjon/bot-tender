const axios = require("axios");

function getFileName(path, defaultPrefix, lotId, customName) {
  if (customName && customName.includes(".")) return customName;
  if (path) {
    const base = path.split("/").pop();
    if (base && base.includes(".")) return base;
  }
  return `${defaultPrefix}_${lotId}`;
}

/**
 * Extracts file metadata from etender.uzex.uz
 * @param {string|number} lotId 
 * @returns {Promise<Array<{name: string, path: string, type: string}>>}
 */
async function extractEtenderFiles(lotId) {
  try {
    const tradeUrl = `https://apietender.uzex.uz/api/common/GetTrade/${lotId}/0`;
    const response = await axios.get(tradeUrl, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
      }
    });

    const data = response.data;
    if (!data) return [];

    const files = [];

    // Technical specification file
    if (data.tech_file_path) {
      files.push({
        name: getFileName(data.tech_file_path, "tech_specification", lotId, data.tech_file_name),
        path: data.tech_file_path,
        type: "etender_download_path"
      });
    }

    // Additional technical documentation file
    if (data.tech_doc_file_path && data.tech_doc_file_path !== data.tech_file_path) {
      files.push({
        name: getFileName(data.tech_doc_file_path, "tech_doc", lotId),
        path: data.tech_doc_file_path,
        type: "etender_download_path"
      });
    }

    // Contract proform file
    if (data.contract_proform_file_path && data.contract_proform_file_path !== data.tech_file_path) {
      files.push({
        name: getFileName(data.contract_proform_file_path, "contract_proform", lotId),
        path: data.contract_proform_file_path,
        type: "etender_download_path"
      });
    }

    return files;
  } catch (error) {
    console.error(`[etenderExtractor] Error extracting files for lot ${lotId}:`, error.message);
    return [];
  }
}

module.exports = { extractEtenderFiles };
