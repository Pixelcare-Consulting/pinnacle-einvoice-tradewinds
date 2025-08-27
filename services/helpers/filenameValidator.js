/**
 * Filename Validation Helper
 * Provides reusable functions for validating file naming conventions
 * 
 * Pattern: {date}_{timestamp}.xlsx
 * Example: 070325_114429.xlsx
 * Where:
 * - date: DDMMYY format (6 digits)
 * - timestamp: HHMMSS format (6 digits)
 * - extension: .xlsx
 */

const path = require('path');

/**
 * Validates if a filename follows the expected pattern: {date}_{timestamp}.xlsx
 * @param {string} filename - The filename to validate
 * @returns {Object} Validation result with isValid, parsedData, and error details
 */
const validateExcelFilename = (filename) => {
  const result = {
    isValid: false,
    parsedData: null,
    error: null,
    pattern: 'DDMMYY_HHMMSS.xlsx'
  };

  try {
    // Check if filename is provided
    if (!filename || typeof filename !== 'string') {
      result.error = 'Filename is required and must be a string';
      return result;
    }

    // Extract just the filename without path
    const baseFilename = path.basename(filename);
    
    // Check file extension (allow .xlsx and .xls)
    const ext = path.extname(baseFilename).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      result.error = 'File must have .xlsx or .xls extension';
      return result;
    }

    // Remove extension to get the base name
    const nameWithoutExt = baseFilename.slice(0, -ext.length);

    // Validate pattern: DDMMYY_HHMMSS
    const filenamePattern = /^(\d{6})_(\d{6})$/;
    const match = nameWithoutExt.match(filenamePattern);
    
    if (!match) {
      result.error = `Filename '${baseFilename}' does not match pattern DDMMYY_HHMMSS.xlsx. Example: 070325_114429.xlsx`;
      return result;
    }

    const [, dateStr, timeStr] = match;
    
    // Parse date components (DDMMYY)
    const day = parseInt(dateStr.substring(0, 2), 10);
    const month = parseInt(dateStr.substring(2, 4), 10);
    const year = parseInt(dateStr.substring(4, 6), 10);
    
    // Parse time components (HHMMSS)
    const hour = parseInt(timeStr.substring(0, 2), 10);
    const minute = parseInt(timeStr.substring(2, 4), 10);
    const second = parseInt(timeStr.substring(4, 6), 10);
    
    // Validate date ranges
    if (day < 1 || day > 31) {
      result.error = `Invalid day: ${day}. Must be between 01-31`;
      return result;
    }
    
    if (month < 1 || month > 12) {
      result.error = `Invalid month: ${month}. Must be between 01-12`;
      return result;
    }
    
    // Validate time ranges
    if (hour > 23) {
      result.error = `Invalid hour: ${hour}. Must be between 00-23`;
      return result;
    }
    
    if (minute > 59) {
      result.error = `Invalid minute: ${minute}. Must be between 00-59`;
      return result;
    }
    
    if (second > 59) {
      result.error = `Invalid second: ${second}. Must be between 00-59`;
      return result;
    }

    // Create full year (assuming 20XX for years 00-99)
    const fullYear = year < 50 ? 2000 + year : 1900 + year;
    
    // Try to create a valid date object for additional validation
    const dateObj = new Date(fullYear, month - 1, day, hour, minute, second);
    
    if (dateObj.getDate() !== day || 
        dateObj.getMonth() !== month - 1 || 
        dateObj.getFullYear() !== fullYear) {
      result.error = `Invalid date: ${day}/${month}/${year}. Date does not exist`;
      return result;
    }

    // If we get here, the filename is valid
    result.isValid = true;
    result.parsedData = {
      originalFilename: baseFilename,
      nameWithoutExtension: nameWithoutExt,
      dateString: dateStr,
      timeString: timeStr,
      date: {
        day: day,
        month: month,
        year: year,
        fullYear: fullYear
      },
      time: {
        hour: hour,
        minute: minute,
        second: second
      },
      dateObject: dateObj,
      formattedDate: `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${fullYear}`,
      formattedTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`,
      formattedDateTime: dateObj.toISOString()
    };

  } catch (error) {
    result.error = `Error validating filename: ${error.message}`;
  }

  return result;
};

/**
 * Validates multiple filenames and returns results for each
 * @param {string[]} filenames - Array of filenames to validate
 * @returns {Object[]} Array of validation results
 */
const validateMultipleFilenames = (filenames) => {
  if (!Array.isArray(filenames)) {
    throw new Error('Filenames must be an array');
  }

  return filenames.map(filename => ({
    filename,
    ...validateExcelFilename(filename)
  }));
};

/**
 * Filters an array of filenames to only include valid ones
 * @param {string[]} filenames - Array of filenames to filter
 * @returns {Object} Object containing valid and invalid filenames with details
 */
const filterValidFilenames = (filenames) => {
  const results = validateMultipleFilenames(filenames);
  
  return {
    valid: results.filter(r => r.isValid),
    invalid: results.filter(r => !r.isValid),
    summary: {
      total: results.length,
      validCount: results.filter(r => r.isValid).length,
      invalidCount: results.filter(r => !r.isValid).length
    }
  };
};

/**
 * Generates a valid filename based on current date and time
 * @param {Date} [date] - Optional date object, defaults to current date/time
 * @returns {string} Generated filename in the correct format
 */
const generateValidFilename = (date = new Date()) => {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(-2);
  
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  const second = date.getSeconds().toString().padStart(2, '0');
  
  return `${day}${month}${year}_${hour}${minute}${second}.xlsx`;
};

module.exports = {
  validateExcelFilename,
  validateMultipleFilenames,
  filterValidFilenames,
  generateValidFilename
};
