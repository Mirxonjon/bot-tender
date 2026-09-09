const pdfLib = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

const MAX_CHARS_PER_DOCUMENT = 12000;
const MAX_TOTAL_CHARS = 25000;

/**
 * Parses text from a PDF buffer
 * @param {Buffer} buffer 
 * @returns {Promise<string>}
 */
async function parsePdf(buffer) {
  try {
    if (typeof pdfLib === "function") {
      const data = await pdfLib(buffer);
      return (data.text || "").trim();
    } else if (pdfLib && pdfLib.PDFParse) {
      const parser = new pdfLib.PDFParse({ data: buffer });
      await parser.load();
      const res = await parser.getText();
      const text = res?.text || (typeof res === "string" ? res : "");
      return text.trim();
    }
    return "";
  } catch (err) {
    console.warn("[documentParser] PDF parse error:", err.message);
    return "";
  }
}

/**
 * Parses text from a DOCX buffer
 * @param {Buffer} buffer 
 * @returns {Promise<string>}
 */
async function parseDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || "").trim();
  } catch (err) {
    console.warn("[documentParser] DOCX parse error:", err.message);
    return "";
  }
}

/**
 * Parses text from an Excel XLSX/XLS buffer
 * @param {Buffer} buffer 
 * @returns {Promise<string>}
 */
async function parseExcel(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts = [];

    for (const sheetName of workbook.SheetNames.slice(0, 5)) {
      const worksheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      if (csv && csv.trim()) {
        textParts.push(`[Лист: ${sheetName}]\n${csv.trim()}`);
      }
    }

    return textParts.join("\n\n");
  } catch (err) {
    console.warn("[documentParser] Excel parse error:", err.message);
    return "";
  }
}

/**
 * Parses text from a single downloaded file object
 * @param {{name: string, buffer: Buffer, ext: string}} fileObj 
 * @returns {Promise<{name: string, text: string}>}
 */
async function parseFile(fileObj) {
  if (!fileObj || !fileObj.buffer) return { name: fileObj?.name || "", text: "" };

  const ext = (fileObj.ext || "").toLowerCase();
  let text = "";

  if (ext === "pdf" || fileObj.buffer.slice(0, 4).toString() === "%PDF") {
    text = await parsePdf(fileObj.buffer);
  } else if (ext === "docx") {
    text = await parseDocx(fileObj.buffer);
  } else if (ext === "xlsx" || ext === "xls") {
    text = await parseExcel(fileObj.buffer);
  } else if (ext === "txt" || ext === "csv" || ext === "rtf") {
    text = fileObj.buffer.toString("utf-8");
  } else {
    // Try PDF first, then DOCX, then Excel
    if (fileObj.buffer.slice(0, 4).toString() === "%PDF") {
      text = await parsePdf(fileObj.buffer);
    } else {
      text = await parseDocx(fileObj.buffer);
      if (!text) text = await parseExcel(fileObj.buffer);
    }
  }

  // Normalize whitespace
  const cleanText = (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    name: fileObj.name,
    text: cleanText.slice(0, MAX_CHARS_PER_DOCUMENT)
  };
}

/**
 * Parses multiple downloaded files into a combined text structure
 * @param {Array<{name: string, buffer: Buffer, ext: string}>} filesList 
 * @returns {Promise<{combinedText: string, parsedFiles: Array<{name: string, length: number}>, hasReadableText: boolean}>}
 */
async function parseDocuments(filesList) {
  if (!Array.isArray(filesList) || filesList.length === 0) {
    return { combinedText: "", parsedFiles: [], hasReadableText: false };
  }

  const parsedFiles = [];
  const textSections = [];
  let totalLength = 0;

  for (const fileObj of filesList) {
    const { name, text } = await parseFile(fileObj);
    if (text && text.length > 50) {
      // More than 50 chars of meaningful text
      parsedFiles.push({ name, length: text.length });
      textSections.push(`=== ДОКУМЕНТ: ${name} ===\n${text}\n`);
      totalLength += text.length;

      if (totalLength >= MAX_TOTAL_CHARS) break;
    }
  }

  const combinedText = textSections.join("\n\n").slice(0, MAX_TOTAL_CHARS);
  const hasReadableText = combinedText.length > 100;

  return {
    combinedText,
    parsedFiles,
    hasReadableText
  };
}

module.exports = {
  parseFile,
  parseDocuments
};
