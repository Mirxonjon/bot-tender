const axios = require("axios");
const OpenAI = require("openai");
const Tender = require("../model/tender");
const { getBot } = require("../bot/bot");
const {
  STAGE1_SYSTEM_PROMPT,
  STAGE2_PRESALE_SYSTEM_PROMPT,
} = require("./prompts");
const { getLotFiles } = require("./fileExtractors/urlRouter");
const { downloadFilesList } = require("./fileDownloader");
const { parseDocuments } = require("./documentParser");

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

const extractTenderAsiaItems = (raw) => {
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
  url: item.id ? `https://etender.uzex.uz/lot/${item.id}` : null,
  lots: null,
});

const fetchUzExTradeList = async () => {
  const requestBodyBase = { From: 0, To: 99999, System_Id: 0 };
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

/**
 * Parses the raw markdown/text output of Stage 2 Presale analysis
 * @param {string} rawText 
 * @returns {{status: string, isMatched: boolean, score: number|null, decision: string, rawText: string}}
 */
function parseStage2Analysis(rawText) {
  if (!rawText) {
    return {
      status: "🟢 ПОДХОДИТ",
      isMatched: true,
      score: null,
      decision: "Изучить подробнее",
      rawText: "",
    };
  }

  const text = rawText.trim();
  let status = "🟢 ПОДХОДИТ";
  let isMatched = true;

  // 1. Detect Status
  if (
    text.includes("🔴 НЕ ПОДХОДИТ") ||
    /2\.\s*НАСКОЛЬКО\s*ЛОТ\s*ПОДХОДИТ\s*НАМ\?[\s\S]{0,120}НЕ ПОДХОДИТ/i.test(text)
  ) {
    status = "🔴 НЕ ПОДХОДИТ";
    isMatched = false;
  } else if (
    text.includes("🟡 ЧАСТИЧНО ПОДХОДИТ") ||
    /2\.\s*НАСКОЛЬКО\s*ЛОТ\s*ПОДХОДИТ\s*НАМ\?[\s\S]{0,120}ЧАСТИЧНО/i.test(text)
  ) {
    status = "🟡 ЧАСТИЧНО ПОДХОДИТ";
    isMatched = true;
  } else if (
    text.includes("🟢 ПОДХОДИТ") ||
    /2\.\s*НАСКОЛЬКО\s*ЛОТ\s*ПОДХОДИТ\s*НАМ\?[\s\S]{0,120}ПОДХОДИТ/i.test(text)
  ) {
    status = "🟢 ПОДХОДИТ";
    isMatched = true;
  }

  // Double check Final Recommendation (Section 13)
  if (
    /13\.\s*ФИНАЛЬНАЯ\s*РЕКОМЕНДАЦИЯ[\s\S]{0,250}Не участвовать/i.test(text) &&
    !text.includes("🟢 ПОДХОДИТ")
  ) {
    status = "🔴 НЕ ПОДХОДИТ";
    isMatched = false;
  }

  // 2. Extract Score
  let score = null;
  const scoreMatch = text.match(
    /(?:ОБЩИЙ\s*SCORE|Общий\s*балл|Total\s*Score|Итоговый\s*балл)[\s:]*(\d{1,3})/i
  );
  if (scoreMatch) {
    score = parseInt(scoreMatch[1], 10);
  }

  // 3. Extract Decision
  let decision = "Участвовать";
  const decisionMatch = text.match(/РЕШЕНИЕ[\s:]*([^\n\r.]+)/i);
  if (decisionMatch) {
    decision = decisionMatch[1].trim();
  }

  return {
    status,
    isMatched,
    score,
    decision,
    rawText: text,
  };
}

/**
 * Main analysis pipeline: Stage 1 (JSON) -> Stage 2 (File TZ Presale Analysis)
 */
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
      const existing =
        (await Tender.findOne({ tenderId: tenderKey })) ||
        (item.source === TENDER_ASIA_SOURCE
          ? await Tender.findOne({ tenderId: item.id.toString() })
          : null);
      if (existing) continue;

      console.log(`\n======================================================`);
      console.log(`[Stage 1] Analyzing tender: ${item.source} ${item.id} - ${item.name}`);

      // ==========================================
      // STAGE 1: Fast JSON Metadata Analysis
      // ==========================================
      const promptContentStage1 = `Source: ${item.source}
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

      const completionStage1 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: STAGE1_SYSTEM_PROMPT },
          { role: "user", content: promptContentStage1 },
        ],
        response_format: { type: "json_object" },
      });

      const replyTextStage1 = completionStage1.choices[0].message.content;
      let jsonAnalysis;
      try {
        jsonAnalysis = JSON.parse(replyTextStage1);
      } catch (e) {
        console.error("Failed to parse OpenAI Stage 1 response:", replyTextStage1);
        continue;
      }

      const jsonMatched = jsonAnalysis.result === "MATCH";
      jsonAnalysis.jsonMatched = jsonMatched;

      console.log(`[Stage 1 Result] jsonMatched: ${jsonMatched}, Category: ${jsonAnalysis.category}, Reason: ${jsonAnalysis.reason}`);

      // If Stage 1 did NOT match: reject immediately without downloading files
      if (!jsonMatched) {
        await notifyGroup(item, jsonAnalysis, false, null);

        await Tender.create({
          tenderId: tenderKey,
          source: item.source,
          title: item.name,
          jsonMatched: false,
          isMatched: false,
          jsonAnalysis,
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // ==========================================
      // STAGE 2: Deep File Download & Presale Analysis
      // ==========================================
      console.log(`[Stage 2] Starting deep TZ analysis for matched lot: ${item.id}`);

      let filesInfo = [];
      let parsedDocs = { combinedText: "", parsedFiles: [], hasReadableText: false };

      try {
        const candidateFiles = await getLotFiles(item);
        filesInfo = candidateFiles;
        console.log(`[Stage 2] Found ${candidateFiles.length} candidate files`);

        if (candidateFiles.length > 0) {
          const downloadedFiles = await downloadFilesList(candidateFiles);
          console.log(`[Stage 2] Successfully downloaded ${downloadedFiles.length} files`);

          parsedDocs = await parseDocuments(downloadedFiles);
          console.log(`[Stage 2] Document parsing result: hasReadableText=${parsedDocs.hasReadableText}, files count=${parsedDocs.parsedFiles.length}`);
        }
      } catch (fileErr) {
        console.error(`[Stage 2] Error during file extraction/download:`, fileErr.message);
      }

      let finalIsMatched = true;
      let stage2Result = null;

      if (parsedDocs.hasReadableText) {
        // We have readable text from technical documents -> Run Stage 2 Presale Prompt
        const promptContentStage2 = `ЛОТ:
Название: ${item.name}
Заказчик: ${item.company || "Не указан"}
Регион: ${item.region || "Не указан"}
Бюджет / Сумма: ${item.price ? `${item.price} ${item.currency || "UZS"}` : "Не указана"}
Ссылка: ${item.url || `https://etender.uzex.uz/lot/${item.id}`}

=== ТЕХНИЧЕСКОЕ ЗАДАНИЕ / ДОКУМЕНТАЦИЯ ИЗ ФАЙЛОВ ===
${parsedDocs.combinedText}
====================================================`;

        console.log(`[Stage 2] Sending extracted TZ (${parsedDocs.combinedText.length} chars) to OpenAI Presale Model...`);

        const completionStage2 = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: STAGE2_PRESALE_SYSTEM_PROMPT },
            { role: "user", content: promptContentStage2 },
          ],
        });

        const replyTextStage2 = completionStage2.choices[0].message.content;
        stage2Result = parseStage2Analysis(replyTextStage2);
        finalIsMatched = stage2Result.isMatched;

        console.log(`[Stage 2 Presale Result] Status: ${stage2Result.status}, Score: ${stage2Result.score}, Decision: ${stage2Result.decision}, final isMatched: ${finalIsMatched}`);
      } else {
        // Files were non-text (drawings, video, images) or no files attached -> Fallback to Stage 1 match
        finalIsMatched = true; // since jsonMatched was true
        stage2Result = {
          status: "🟢 ПОДХОДИТ (По метаданным JSON)",
          isMatched: true,
          score: null,
          decision: "Изучить подробнее",
          note: "Файлы ТЗ не содержат распознаваемого текста либо представлены в виде чертежей/медиа. Решение принято на основе анализа JSON.",
          rawText: null,
        };
        console.log(`[Stage 2 Fallback] No readable TZ text found. Using Stage 1 match (isMatched=true).`);
      }

      // Notify Telegram & Save to MongoDB
      await notifyGroup(item, jsonAnalysis, finalIsMatched, stage2Result);

      await Tender.create({
        tenderId: tenderKey,
        source: item.source,
        title: item.name,
        jsonMatched: true,
        isMatched: finalIsMatched,
        jsonAnalysis,
        deepAnalysis: stage2Result,
        deepAnalysisRaw: stage2Result?.rawText || null,
        statusTz: stage2Result?.status || null,
        score: stage2Result?.score || null,
        filesInfo: parsedDocs.parsedFiles,
      });

      // Small delay to avoid OpenAI rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } catch (err) {
    console.error("Error in analyzeTenders pipeline:", err.message);
  }
};

const escapeHtml = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const sendTelegramMessage = async (bot, chatId, message, options = {}) => {
  try {
    await bot.sendMessage(chatId, message, options);
    console.log(`Message sent to chat ${chatId} (thread: ${options.message_thread_id || 'general'})`);
  } catch (err) {
    console.error(`Error sending message to chat ${chatId}:`, err.message);
  }
};

/**
 * Sends formatted notifications to Telegram groups/topics
 */
const notifyGroup = async (item, jsonAnalysis, isMatched, deepAnalysis = null) => {
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
            `- ${escapeHtml(lot.name)}: ${new Intl.NumberFormat("uz-UZ").format(lot.price)} ${escapeHtml(lot.currency || "UZS")}`
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

  const categoryLine = jsonAnalysis?.category ? `📁 Kategoriya: <b>${escapeHtml(jsonAnalysis.category)}</b>\n` : "";
  const itemName = escapeHtml(item.name || "Noma'lum");
  const compName = escapeHtml(item.company || "Noma'lum");
  const regionName = escapeHtml(item.region || "Noma'lum");
  const reasonText = escapeHtml((jsonAnalysis?.reason || "").trim());

  let message = "";

  if (isMatched) {
    let statusHeader = "";
    if (deepAnalysis) {
      const statusBadge = deepAnalysis.status || "🟢 ПОДХОДИТ";
      const scoreBadge = deepAnalysis.score ? ` | 🏆 Score: <b>${deepAnalysis.score}/100</b>` : "";
      const decisionBadge = deepAnalysis.decision ? ` | 📌 <b>${escapeHtml(deepAnalysis.decision)}</b>` : "";
      statusHeader = `🎯 Status: ${statusBadge}${scoreBadge}${decisionBadge}\n\n`;
    }

    let accordionDetails = "";
    if (deepAnalysis && deepAnalysis.rawText) {
      const recMatch = deepAnalysis.rawText.match(/13\.\s*ФИНАЛЬНАЯ\s*РЕКОМЕНДАЦИЯ[\s\S]*$/i);
      const descMatch = deepAnalysis.rawText.match(/1\.\s*КРАТКОЕ\s*ОПИСАНИЕ\s*ЛОТА\s*([\s\S]*?)(?=2\.\s*НАСКОЛЬКО|$)/i);

      let descText = descMatch && descMatch[1] ? descMatch[1].trim() : "";
      let recText = recMatch ? recMatch[0].trim() : "";

      accordionDetails =
        `<blockquote expandable>` +
        (descText ? `📋 <b>Tavsif:</b>\n${escapeHtml(descText)}\n\n` : "") +
        (recText ? `💡 <b>Presale tavsiyasi:</b>\n${escapeHtml(recText)}\n\n` : "") +
        (reasonText ? `🔍 <b>JSON xulosasi:</b>\n${reasonText}` : "") +
        `</blockquote>\n\n`;
    } else if (deepAnalysis && deepAnalysis.note) {
      accordionDetails =
        `<blockquote expandable>` +
        `ℹ️ <i>${escapeHtml(deepAnalysis.note)}</i>\n\n` +
        (reasonText ? `🔍 <b>JSON xulosasi:</b>\n${reasonText}` : "") +
        `</blockquote>\n\n`;
    } else if (reasonText) {
      accordionDetails =
        `<blockquote expandable>` +
        `🔍 <b>JSON xulosasi:</b>\n${reasonText}` +
        `</blockquote>\n\n`;
    }

    message =
      `<blockquote>${itemName}</blockquote>\n\n` +
      categoryLine +
      `🏢 Tashkilot: ${compName}\n` +
      `📍 Hudud: ${regionName}\n` +
      `💰 Umumiy narx: ${escapeHtml(price)} ${escapeHtml(currency)}\n` +
      (lotDetails ? `${lotDetails}\n` : "") +
      `\n` +
      statusHeader +
      accordionDetails +
      `🔗 Tender havolasi: <a href="${tenderLink}">${escapeHtml(tenderLink)}</a>\n` +
      `🧾 Manba: ${escapeHtml(sourceLabel)}`;
  } else {
    // NOT MATCHED
    message =
      `❌\n\n` +
      `<blockquote>${itemName}</blockquote>\n\n` +
      `<blockquote expandable>` +
      `${reasonText}` +
      `</blockquote>\n\n` +
      `💰 ${escapeHtml(price)} ${escapeHtml(currency)}\n\n` +
      `🔗 Tender havolasi: <a href="${tenderLink}">${escapeHtml(tenderLink)}</a>\n\n` +
      `🧾 Manba: ${escapeHtml(sourceLabel)}`;
  }

  // 1) Send to main group
  const baseOptions = {
    disable_web_page_preview: true,
    parse_mode: 'HTML',
  };
  await sendTelegramMessage(bot, groupId, message, baseOptions);

  // 2) Send to topics group if configured
  const topicsGroupId = process.env.GROUP_ID_TOPICS;
  const topicId = isMatched
    ? process.env.TOPIC_ID_MATCH
    : process.env.TOPIC_ID_NOT_MATCH;

  if (topicsGroupId && topicId) {
    await sendTelegramMessage(bot, topicsGroupId, message, {
      ...baseOptions,
      message_thread_id: parseInt(topicId, 10),
    });
  }
};

module.exports = {
  analyzeTenders,
  parseStage2Analysis,
  notifyGroup,
};