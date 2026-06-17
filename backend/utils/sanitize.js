import sanitize from 'sanitize-html';

/**
 * Sanitizes unsafe HTML content by filtering out potentially malicious script tags,
 * event listeners, and unauthorized styling attributes, while preserving benign rich text features.
 * Used for formatting components like "Extra Business Info" in PDF rendering headers.
 * 
 * @param {string} rawHtml - Unsanitized HTML string from user inputs.
 * @returns {string} Clean, safe HTML string.
 */
export const sanitizeHtmlContent = (rawHtml) => {
  if (!rawHtml) return '';

  return sanitize(rawHtml, {
    // Whitelist tags that are benign for document layout rendering
    allowedTags: [
      'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'div', 'u', 'h1', 'h2', 'h3', 'table', 'tr', 'td', 'th', 'tbody', 'thead'
    ],
    // Limit attributes specifically to links and formatting
    allowedAttributes: {
      'a': ['href', 'name', 'target', 'rel'],
      'span': ['style'],
      'div': ['style'],
      'td': ['colspan', 'rowspan', 'style'],
      'th': ['colspan', 'rowspan', 'style']
    },
    // Filter inline styles to avoid UI hijack or breaks
    allowedStyles: {
      '*': {
        'color': [/^\#(?:[0-9a-fA-F]{3,4}){1,2}$/, /^rgb\(/, /^rgba\(/, /^[a-zA-Z]+$/],
        'background-color': [/^\#(?:[0-9a-fA-F]{3,4}){1,2}$/, /^rgb\(/, /^rgba\(/, /^[a-zA-Z]+$/],
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        'font-size': [/^\d+(?:px|em|rem|\%)$/],
        'font-weight': [/^[a-zA-Z0-9]+$/]
      }
    }
  });
};
