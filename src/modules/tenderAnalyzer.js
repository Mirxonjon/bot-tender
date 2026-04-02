const axios = require("axios");
const OpenAI = require("openai");
const Tender = require("../model/tender");
const { getBot } = require("../bot/bot");

// Setup OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TENDER_ASIA_API_URL =
  "https://tender.asia/api/tenders/?limit=99999&offset=0&status=open&page_refreshed=True";

const UZEX_TRADELIST_API_URL =
  "https://apietender.uzex.uz/api/common/TradeList";

const TENDER_ASIA_SOURCE = "Tender Asia";
const UZEX_SOURCE = "UzEx";

const SYSTEM_PROMPT = `You are an expert procurement classifier.

Your task is to determine whether the given lot matches WEB DEVELOPMENT SERVICES.

WEB DEVELOPMENT SERVICES includes:
- website development
- web application development
- portal development
- CRM / ERP / dashboard / admin panel development
- frontend development
- backend development
- full-stack development
- API development or integration
- database-driven systems
- support, modernization, maintenance, or improvement of existing web systems
- UI/UX design for web platforms
- e-government or corporate information systems if they involve web/software development

NOT MATCHING includes:
- security services
- cleaning services
- construction and repair
- office supplies
- furniture
- electronics supply only
- internet or hosting only
- CCTV
- vehicle services
- legal/accounting services
- printing services
- physical equipment delivery
- mobile app only, unless the lot clearly includes web platform development too

Decision rules:
1. Return MATCH if the lot is clearly about creating, developing, updating, maintaining, or integrating a web-based software system.
2. Return NOT_MATCH if it is about physical goods, non-IT services, or unrelated services.
3. If the lot is about general software or IT services but web development is not clearly mentioned, return NOT_MATCH.
4. If the lot mentions both software and hardware, choose MATCH only if web/software development is the main scope.
5. Be strict. Do not guess positively without evidence.

Return JSON only in this format:
{
  "result": "MATCH" or "NOT_MATCH",
  "confidence": 0-100,
  "reason": "short explanation in Uzbek"
}`;

const extractTenderAsiaItems = (raw) => {
  // Tender Asia response shape varies; try the most common paths first.
  if (Array.isArray(raw?.tenders?.data)) return raw.tenders.data;
  if (Array.isArray(raw?.results?.tenders?.data))
    return raw.results.tenders.data;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
};

const normalizeTenderAsiaItem = (item) => ({
  source: TENDER_ASIA_SOURCE,
  id: item.id,
  name: item.name,
  description: item.description || "",
  price: item.price,
  currency: item.currency || "UZS",
  company: item.company,
  region: item.region,
  url: item.url,
  lots: item.lots,
});

const fetchTenderAsia = async () => {
  const response = await axios.get(TENDER_ASIA_API_URL);
  const items = extractTenderAsiaItems(response.data);
  return items.map(normalizeTenderAsiaItem);
};

const normalizeUzExItem = (item) => ({
  source: UZEX_SOURCE,
  id: item.id,
  displayNo: item.display_no,
  name: item.name,
  // UzEx TradeList doesn't always include a separate "description" field,
  // so we synthesize it from metadata (keep it concise; meta details go into the prompt).
  description: [
    `Start date: ${item.start_date || ""}`.trim(),
    `End date: ${item.end_date || ""}`.trim(),
    `Clarific date: ${item.clarific_date || ""}`.trim(),
    `Total count: ${item.total_count ?? ""}`.trim(),
    `Cost: ${item.cost ?? ""}`.trim(),
    `Currency: ${item.currency_codeabc || item.currency || ""}`.trim(),
    `Category name: ${item.category_name || ""}`.trim(),
  ]
    .filter((s) => s && s !== "Category name:".trim())
    .join("\n"),
  price: item.cost,
  currency: item.currency_codeabc || "UZS",
  company: item.seller_name,
  sellerTin: item.seller_tin,
  region: [item.region_name, item.district_name].filter(Boolean).join(" - "),
  url: null,
  lots: null,
});

const fetchUzExTradeList = async () => {
  const requestBodyBase = { From: 0, To: 99999, System_Id: 0 };

  // UzEx expects two TypeId values (2 and 1).
  const typeIds = [2, 1];

  const all = [];
  for (const typeId of typeIds) {
    const response = await axios.post(UZEX_TRADELIST_API_URL, {
      ...requestBodyBase,
      TypeId: typeId,
    });
    if (Array.isArray(response.data)) {
      all.push(...response.data);
    }
  }

  return all.map(normalizeUzExItem);
};

const analyzeTenders = async () => {
  try {
    console.log("Fetching tenders from sources...");

    const [tenderAsiaItems, uzexItems] = await Promise.all([
      fetchTenderAsia().catch((err) => {
        console.error("Tender Asia fetch failed:", err.message);
        return [];
      }),
      fetchUzExTradeList().catch((err) => {
        console.error("UzEx fetch failed:", err.message);
        return [];
      }),
    ]);

    const allItems = [...tenderAsiaItems, ...uzexItems];

    for (const item of allItems) {
      if (!item || !item.id || !item.name) continue;

      const tenderKey = `${item.source}:${item.id.toString()}`;
      // Backward compatibility: older records stored tenderId as just `id`.
      const existing =
        (await Tender.findOne({ tenderId: tenderKey })) ||
        (item.source === TENDER_ASIA_SOURCE
          ? await Tender.findOne({ tenderId: item.id.toString() })
          : null);
      if (existing) continue;

      const promptContent = `Source: ${item.source}
Lot:
Name: ${item.name}
Description:
${item.description || ""}

Meta:
Company: ${item.company || ""}
Seller TIN: ${item.sellerTin || ""}
Region: ${item.region || ""}
Display/ID: ${
        item.source === UZEX_SOURCE ? item.displayNo || "" : item.id || ""
      }`;

      console.log(`Analyzing tender: ${item.source} ${item.id} - ${item.name}`);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: promptContent },
        ],
        response_format: { type: "json_object" },
      });

      const replyText = completion.choices[0].message.content;
      let analysis;
      try {
        analysis = JSON.parse(replyText);
      } catch (e) {
        console.error("Failed to parse OpenAI response:", replyText);
        continue;
      }

      const isMatched = analysis.result === "MATCH";
      analysis.isMatched = isMatched; // keep for any future uses

      await notifyGroup(item, analysis, isMatched);

      await Tender.create({
        tenderId: tenderKey,
        source: item.source,
        title: item.name,
        isMatched,
      });

      // Small delay to avoid OpenAI rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (err) {
    console.error("Error analyzing tenders:", err.message);
  }
};

const notifyGroup = async (item, analysis, isMatched) => {
  const groupId = isMatched
    ? process.env.GROUP_ID_MATCH
    : process.env.GROUP_ID_NOT_MATCH;
  const bot = getBot();

  if (!groupId || !bot) {
    console.warn("Cannot send notification: GROUP_ID or bot instance missing.");
    return;
  }

  const price = item.price
    ? new Intl.NumberFormat("uz-UZ").format(item.price)
    : "Noma'lum";
  const currency = item.currency || "UZS";

  let lotDetails = "";
  if (item.lots && item.lots.length > 0) {
    lotDetails =
      "\n📦 Lotlar hajmi va narxi:\n" +
      item.lots
        .map(
          (lot) =>
            `- ${lot.name}: ${new Intl.NumberFormat("uz-UZ").format(lot.price)} ${lot.currency || "UZS"}`
        )
        .join("\n");
  }

  const sourceLabel =
    item.source === UZEX_SOURCE ? "UzEx" : "Tender Asia";
  const tenderLink =
    item.url ||
    (item.source === UZEX_SOURCE && item.id
      ? `https://etender.uzex.uz/lot/${item.id}`
      : "Noma'lum");

  const message = isMatched
    ? `<blockquote>${item.name || "Noma'lum"}</blockquote>\n\n` +
      `🏢 Tashkilot: ${item.company || "Noma'lum"}\n` +
      `📍 Hudud: ${item.region || "Noma'lum"}\n` +
      `💰 Umumiy narx: ${price} ${currency}\n` +
      `${lotDetails}\n\n` +
      `🔍 Xulosasi: ${analysis.reason}\n\n` +
      `🔗 Tender havolasi: ${tenderLink}\n` +
      `🧾 Manba: ${sourceLabel}`
    : `❌\n\n` +
      `<blockquote>${item.name || "Noma'lum"}</blockquote>\n\n` +
      `${(analysis.reason || "").trim()}\n\n` +
      `💰 ${price} ${currency}\n\n` +
      `🧾 Manba: ${sourceLabel}`;

  try {
    await bot.sendMessage(groupId, message, {
      disable_web_page_preview: true,
      parse_mode: 'HTML'
    });
    console.log(`Notification sent for tender ${item.id}`);
  } catch (err) {
    console.error(
      `Error sending message to group for tender ${item.id}:`,
      err.message
    );
  }
};

module.exports = { analyzeTenders };