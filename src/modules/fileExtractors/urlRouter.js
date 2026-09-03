const { extractEtenderFiles } = require("./etenderExtractor");
const { extractXaridFiles } = require("./xaridExtractor");
const { extractMcFiles } = require("./mcExtractor");
const { extractXtXaridFiles } = require("./xtXaridExtractor");

/**
 * Routes lot URL/source to the corresponding platform extractor
 * @param {Object} lot - { url, source, id, displayNo }
 * @returns {Promise<Array<{name: string, path?: string, url?: string, type: string}>>}
 */
async function getLotFiles(lot) {
  if (!lot) return [];

  const url = lot.url || "";
  const lotId = lot.id || lot.displayNo;

  try {
    // 1. etender.uzex.uz
    if (url.includes("etender.uzex.uz/lot/")) {
      const match = url.match(/etender\.uzex\.uz\/lot\/(\d+)/i);
      const id = match ? match[1] : lotId;
      if (id) return await extractEtenderFiles(id);
    }

    // 2. xarid.uzex.uz
    if (url.includes("xarid.uzex.uz")) {
      const match = url.match(/(?:detail|auction|shop|direct)\/(\d+)/i);
      const id = match ? match[1] : lotId;
      if (id) return await extractXaridFiles(id);
    }

    // 3. tender.mc.uz (Shaffof Qurilish)
    if (url.includes("tender.mc.uz")) {
      const match = url.match(/tender\/(\d+)/i);
      const id = match ? match[1] : lotId;
      if (id) return await extractMcFiles(id);
    }

    // 4. xt-xarid.uz
    if (url.includes("xt-xarid.uz")) {
      const match = url.match(/procedure\/(\d+)/i);
      const id = match ? match[1] : lotId;
      if (id) return await extractXtXaridFiles(id);
    }

    // 5. Fallback based on Source & ID (e.g. UzEx TradeList items without explicit url)
    if (lot.source === "UzEx" || (!url && lotId)) {
      return await extractEtenderFiles(lotId);
    }
  } catch (error) {
    console.error(`[urlRouter] Error routing files for lot ${lotId}:`, error.message);
  }

  return [];
}

module.exports = { getLotFiles };
