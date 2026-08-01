import DOMPurify from 'dompurify';

/**
 * Safely parses HTML strings on the browser client by using DOMPurify.
 * This is robust against XSS and edge cases compared to custom DOMParser approaches.
 * 
 * @param {string} rawHtml - Unsanitized HTML string.
 * @returns {string} Clean, safe HTML string for rendering.
 */
export const sanitizeHtmlContent = (rawHtml) => {
  if (!rawHtml) return '';
  
  try {
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'div', 'u', 
        'h1', 'h2', 'h3', 'table', 'tr', 'td', 'th', 'thead', 'tbody'
      ],
      ALLOWED_ATTR: ['href', 'target', 'class', 'style'],
    });
  } catch (err) {
    console.error('DOMPurify sanitization error, returning plain text fallback:', err);
    // Return plain text fallback by stripping html tags entirely via regex
    return rawHtml.replace(/<[^>]*>/g, '');
  }
};
