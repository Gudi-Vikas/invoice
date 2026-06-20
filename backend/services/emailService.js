import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const emailService = {
  /**
   * Dispatches email using local file recording for verification & dev previews.
   * @param {{ to: string, subject: string, body: string, html: string }} params
   */
  sendEmail: async ({ to, subject, body, html }) => {
    console.log(`[Email Service] Dispatching email to: ${to}`);
    console.log(`[Email Service] Subject: ${subject}`);

    try {
      const sentEmailsDir = path.join(__dirname, '..', 'sent_emails');
      
      // Ensure the sent_emails directory exists
      if (!fs.existsSync(sentEmailsDir)) {
        fs.mkdirSync(sentEmailsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `email-${timestamp}.html`;
      const filePath = path.join(sentEmailsDir, filename);

      const htmlContent = html || `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${subject}</title>
        </head>
        <body style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2>${subject}</h2>
          <div style="white-space: pre-wrap; margin-top: 15px;">${body}</div>
        </body>
        </html>
      `;

      fs.writeFileSync(filePath, htmlContent, 'utf8');
      console.log(`[Email Service] Saved email body preview to: ${filePath}`);

      return {
        success: true,
        previewFile: filePath,
        filename
      };
    } catch (err) {
      console.error('[Email Service] Failed to save email preview:', err);
      throw err;
    }
  }
};

export default emailService;
