/**
 * Computes a contrasting text color (either dark slate or white) 
 * given a hex background color based on relative luminance.
 *
 * @param {string} hexColor - The background color in hex format (e.g. '#234a75' or '234a75')
 * @returns {string} - The contrast color ('#ffffff' for dark bg, '#1e293b' for light bg)
 */
export const getContrastColor = (hexColor) => {
  if (!hexColor) return '#ffffff';
  
  // Remove hash if present
  let hex = hexColor.replace('#', '');
  
  // Handle 3-digit hex
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  
  if (hex.length !== 6) {
    return '#ffffff';
  }

  // Parse RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Calculate relative luminance using standard sRGB formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // If luminance is high (light background), return dark text. Else white text.
  return luminance > 0.6 ? '#1e293b' : '#ffffff';
};
