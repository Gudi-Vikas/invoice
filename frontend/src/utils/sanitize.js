/**
 * Safely parses HTML strings on the browser client by creating an in-memory DOM,
 * and stripping out unsafe tags (like <script>, <iframe>, etc.) or event handlers (like onload, onclick).
 * This replaces Node-specific sanitizers to keep frontend builds lightweight and bundle-safe.
 * 
 * @param {string} rawHtml - Unsanitized HTML string.
 * @returns {string} Clean, safe HTML string for rendering.
 */
export const sanitizeHtmlContent = (rawHtml) => {
  if (!rawHtml) return '';
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');
    
    // Select all elements in the parsed DOM body
    const allElements = doc.body.querySelectorAll('*');
    
    const allowedTags = [
      'B', 'I', 'EM', 'STRONG', 'A', 'P', 'BR', 'SPAN', 'DIV', 'U', 
      'H1', 'H2', 'H3', 'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY'
    ];
    
    allElements.forEach(el => {
      // 1. Remove disallowed tags completely
      if (!allowedTags.includes(el.tagName)) {
        el.remove();
        return;
      }
      
      // 2. Audit and remove any scripting/event attributes
      Array.from(el.attributes).forEach(attr => {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value.toLowerCase();
        
        // Block inline javascript and handlers
        if (attrName.startsWith('on') || attrValue.includes('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });
    
    return doc.body.innerHTML;
  } catch (err) {
    console.error('DOMParser sanitization error, returning plain text fallback:', err);
    // Return plain text fallback by stripping html tags entirely via regex
    return rawHtml.replace(/<[^>]*>/g, '');
  }
};
