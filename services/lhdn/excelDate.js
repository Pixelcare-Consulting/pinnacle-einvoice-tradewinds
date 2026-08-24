/**
 * Convert Excel date cells to LHDN date strings (YYYY-MM-DD).
 * Excel often stores dates as serials (e.g. 46248 → 2026-08-14).
 * LHDN PaidDate / date fields reject serials and values like "N/A".
 */

const NA_VALUES = new Set([
  "",
  "na",
  "n/a",
  "n.a.",
  "n.a",
  "null",
  "undefined",
  "not applicable",
  "-",
]);

function isBlankOrNa(value) {
  if (value === null || value === undefined) return true;
  return NA_VALUES.has(String(value).trim().toLowerCase());
}

function formatYmd(year, monthIndex0, day) {
  const mm = String(monthIndex0 + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function formatDateLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return formatYmd(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * @param {any} excelDate - Excel serial, Date, or date string
 * @returns {string|null} YYYY-MM-DD or null when empty / N/A / invalid
 */
function convertExcelDate(excelDate) {
  if (isBlankOrNa(excelDate)) return null;

  if (excelDate instanceof Date) {
    return formatDateLocal(excelDate);
  }

  if (typeof excelDate === "string") {
    const trimmed = excelDate.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
    if (/^\d{1,2}[\/.]\d{1,2}[\/.]\d{4}$/.test(trimmed)) {
      const parsed = new Date(trimmed);
      const formatted = formatDateLocal(parsed);
      if (formatted) return formatted;
    }
  }

  const serial = Number(excelDate);
  if (!Number.isFinite(serial) || serial <= 0) {
    return null;
  }

  // Whole/fractional Excel serial (days since 1899-12-30, with Excel leap-year bug).
  // 25569 = serial for 1970-01-01.
  if (serial >= 1 && serial < 2958466) {
    const utcMs = Math.round((serial - 25569) * 86400 * 1000);
    const utc = new Date(utcMs);
    if (!Number.isNaN(utc.getTime())) {
      return utc.toISOString().slice(0, 10);
    }
  }

  return null;
}

module.exports = {
  convertExcelDate,
  isBlankOrNa,
};