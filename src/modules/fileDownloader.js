const axios = require("axios");
const AdmZip = require("adm-zip");
const { createExtractorFromData } = require("node-unrar-js");

const IGNORED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico",
  "mp4", "avi", "mov", "mkv", "webm", "mp3", "wav",
  "dwg", "dxf", "psd", "ai",
  "exe", "dll", "bin", "iso", "apk"
]);

const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "docx", "doc", "xlsx", "xls", "txt", "rtf", "csv"
]);

const ARCHIVE_EXTENSIONS = new Set([
  "zip", "rar", "7z"
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Checks if a file name or extension is a parsable document
 * @param {string} fileName 
 * @returns {boolean}
 */
function isParsableDocument(fileName) {
  if (!fileName) return true;
  const parts = fileName.split(".");
  if (parts.length < 2) return true;
  const ext = parts.pop().toLowerCase();
  return DOCUMENT_EXTENSIONS.has(ext);
}

/**
 * Checks if a file is an archive (zip, rar, 7z)
 * @param {string} fileName 
 * @param {Buffer} [buffer]
 * @returns {boolean}
 */
function isArchiveFile(fileName, buffer) {
  if (fileName && fileName.includes(".")) {
    const ext = fileName.split(".").pop().toLowerCase();
    if (ARCHIVE_EXTENSIONS.has(ext)) return true;
    if (DOCUMENT_EXTENSIONS.has(ext)) return false;
  }

  if (buffer && buffer.length >= 4) {
    // Rar header: 'Rar!' (0x52 0x61 0x72 0x21)
    if (buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21) {
      return true;
    }
    // Zip header: 'PK\x03\x04' (0x50 0x4b 0x03 0x04)
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
      // Exclude docx / xlsx (which contain '[Content_Types].xml')
      const headerStr = buffer.slice(0, 500).toString("latin1");
      if (headerStr.includes("[Content_Types].xml") || headerStr.includes("word/") || headerStr.includes("xl/")) {
        return false; // it is docx or xlsx
      }
      return true;
    }
  }

  return false;
}

/**
 * Checks if a file name or extension is eligible for download
 * @param {string} fileName 
 * @returns {boolean}
 */
function isEligibleFile(fileName) {
  if (!fileName) return true;
  const parts = fileName.split(".");
  if (parts.length < 2) return true; // no extension, could be pdf or archive
  const ext = parts.pop().toLowerCase();
  if (IGNORED_EXTENSIONS.has(ext)) return false;
  return DOCUMENT_EXTENSIONS.has(ext) || ARCHIVE_EXTENSIONS.has(ext);
}

/**
 * Extracts documents from a zip archive buffer
 * @param {Buffer} buffer 
 * @param {string} archiveName 
 * @returns {Array<{name: string, buffer: Buffer, ext: string}>}
 */
function extractFromZip(buffer, archiveName) {
  const extractedFiles = [];
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName;
      const baseName = entryName.split("/").pop() || entryName;

      // Only extract parsable documents
      if (isParsableDocument(baseName)) {
        const ext = baseName.includes(".") ? baseName.split(".").pop().toLowerCase() : "pdf";
        const data = entry.getData();
        if (data && data.length > 0) {
          extractedFiles.push({
            name: `${archiveName}/${entryName}`,
            buffer: data,
            ext
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[fileDownloader] Error unpacking zip archive ${archiveName}:`, err.message);
  }
  return extractedFiles;
}

/**
 * Extracts documents from a rar archive buffer
 * @param {Buffer} buffer 
 * @param {string} archiveName 
 * @returns {Promise<Array<{name: string, buffer: Buffer, ext: string}>>}
 */
async function extractFromRar(buffer, archiveName) {
  const extractedFiles = [];
  try {
    const extractor = await createExtractorFromData({ data: new Uint8Array(buffer) });
    const extracted = extractor.extract();

    if (extracted && extracted.files) {
      for (const file of extracted.files) {
        if (!file.fileHeader || file.fileHeader.flags.directory) continue;
        const entryName = file.fileHeader.name;
        const baseName = entryName.split("/").pop() || entryName;

        if (isParsableDocument(baseName) && file.extraction) {
          const ext = baseName.includes(".") ? baseName.split(".").pop().toLowerCase() : "pdf";
          extractedFiles.push({
            name: `${archiveName}/${entryName}`,
            buffer: Buffer.from(file.extraction),
            ext
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[fileDownloader] Error unpacking rar archive ${archiveName}:`, err.message);
  }
  return extractedFiles;
}

/**
 * Unpacks an archive buffer (zip or rar) and returns all extracted document files
 * @param {Buffer} buffer 
 * @param {string} archiveName 
 * @returns {Promise<Array<{name: string, buffer: Buffer, ext: string}>>}
 */
async function unpackArchive(buffer, archiveName) {
  // Check if RAR
  if (buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21) {
    return await extractFromRar(buffer, archiveName);
  }
  // Try Zip first
  const zipFiles = extractFromZip(buffer, archiveName);
  if (zipFiles.length > 0) return zipFiles;

  // If Zip failed, try RAR fallback
  return await extractFromRar(buffer, archiveName);
}

/**
 * Downloads a file or archive and returns an array of document file objects
 * @param {Object} fileInfo - { name, path, url, type }
 * @returns {Promise<Array<{name: string, buffer: Buffer, ext: string}>>}
 */
async function downloadFile(fileInfo) {
  if (!fileInfo || !isEligibleFile(fileInfo.name)) {
    return [];
  }

  try {
    let buffer = null;

    if (fileInfo.type === "etender_download_path" || fileInfo.path) {
      const downloadUrl = `https://apietender.uzex.uz/api/common/DownloadFile?path=${encodeURIComponent(fileInfo.path)}`;
      const response = await axios.post(downloadUrl, {}, {
        responseType: "arraybuffer",
        timeout: 12000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Content-Type": "application/json",
          "Accept": "*/*"
        },
        maxContentLength: MAX_FILE_SIZE_BYTES
      });
      buffer = Buffer.from(response.data);
    } else if (fileInfo.url) {
      const response = await axios.get(fileInfo.url, {
        responseType: "arraybuffer",
        timeout: 12000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*"
        },
        maxContentLength: MAX_FILE_SIZE_BYTES
      });
      buffer = Buffer.from(response.data);
    }

    if (!buffer || buffer.length === 0) return [];

    const fileName = fileInfo.name || "document";

    // If it's an archive (zip, rar, etc.) -> unpack all inner documents!
    if (isArchiveFile(fileName, buffer)) {
      console.log(`[fileDownloader] Unpacking archive: ${fileName} (${buffer.length} bytes)...`);
      const extractedDocuments = await unpackArchive(buffer, fileName);
      console.log(`[fileDownloader] Extracted ${extractedDocuments.length} document(s) from archive ${fileName}`);
      return extractedDocuments;
    }

    // Determine document extension
    let ext = "";
    if (fileName && fileName.includes(".")) {
      ext = fileName.split(".").pop().toLowerCase();
    } else if (buffer.slice(0, 4).toString() === "%PDF") {
      ext = "pdf";
    } else if (buffer.slice(0, 2).toString("hex") === "504b") {
      ext = "docx";
    }

    return [{
      name: fileName,
      buffer,
      ext
    }];
  } catch (error) {
    console.warn(`[fileDownloader] Could not download file ${fileInfo.name}:`, error.message);
    return [];
  }
}

/**
 * Downloads multiple files/archives concurrently and flattens all documents
 * @param {Array<Object>} filesList 
 * @returns {Promise<Array<{name: string, buffer: Buffer, ext: string}>>}
 */
async function downloadFilesList(filesList) {
  if (!Array.isArray(filesList) || filesList.length === 0) return [];

  const candidateFiles = filesList.filter(f => isEligibleFile(f.name));
  const downloadPromises = candidateFiles.slice(0, 6).map(f => downloadFile(f));
  const resultsArrays = await Promise.all(downloadPromises);

  // Flatten array of arrays
  const allDocuments = [];
  for (const docArray of resultsArrays) {
    if (Array.isArray(docArray)) {
      allDocuments.push(...docArray);
    }
  }

  return allDocuments;
}

module.exports = {
  isEligibleFile,
  isParsableDocument,
  isArchiveFile,
  downloadFile,
  downloadFilesList
};
