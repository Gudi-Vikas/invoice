/**
 * Utility for converting DOM elements directly into downloadable PDF files.
 * Uses html2pdf.js loaded dynamically on-demand.
 *
 * @param {string} elementId - The DOM ID of the container to capture (e.g. 'print-area')
 * @param {string} filename  - Target PDF filename (e.g. 'invoice_INV-1001.pdf')
 */
export const downloadElementAsPdf = async (elementId, filename = 'document.pdf') => {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Element #${elementId} not found.`);
  }

  // Load html2pdf.js from CDN if not already loaded
  if (!window.html2pdf) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load PDF generation library. Please check internet connection.'));
      document.body.appendChild(script);
    });
  }

  const opt = {
    margin:       [0.25, 0.25, 0.25, 0.25],
    filename:     filename,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, logging: false, scrollY: 0 },
    jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
  };

  await window.html2pdf().set(opt).from(element).save();
};

export default downloadElementAsPdf;
