/**
 * Input Validation & Normalization Utility
 */

/**
 * Validates email address format against standard RFC-like pattern.
 * @param {string} email
 * @returns {boolean}
 */
export const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim();
  // Standard email regex ensuring valid local part, @ symbol, domain name, and TLD
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(normalized);
};

/**
 * Validates phone number format allowing optional +, digits, spaces, hyphens, and parentheses (8-20 chars).
 * @param {string} phone
 * @returns {boolean}
 */
export const isValidPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  // Permitted phone pattern: optional +, numbers, spaces, hyphens, parentheses; 8 to 20 chars
  const phoneRegex = /^\+?[0-9\s\-()]{8,20}$/;
  return phoneRegex.test(trimmed);
};

/**
 * Normalizes phone number, formatting with default India (+91) prefix if no country code is specified.
 * @param {string} phone
 * @returns {string}
 */
export const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    return trimmed;
  }
  return `+91 ${trimmed}`;
};

/**
 * Normalizes email address to lowercase and trimmed string.
 * @param {string} email
 * @returns {string}
 */
export const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
};
