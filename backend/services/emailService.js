import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const emailService = {
  sendViaGmailOAuth: async ({ to, subject, body, html, oauthUser, oauthRefreshToken, fromName }) => {
    console.log(`[Email Service] Dispatching via Gmail REST API for ${oauthUser}`);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) missing from server environment.');
    }

    // Exchange refresh token for fresh access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: oauthRefreshToken,
        grant_type: 'refresh_token'
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[Email Service] Failed to refresh Gmail access token:', tokenData);
      throw new Error(tokenData.error_description || 'Failed to authenticate with Google OAuth');
    }

    const fromHeader = fromName ? `"${fromName}" <${oauthUser}>` : oauthUser;

    // Construct raw RFC 2822 MIME message
    const rawMessage = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      html || body
    ].join('\n');

    // Base64url encode the message string
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: encodedMessage })
    });

    const sendData = await sendRes.json();

    if (!sendRes.ok || !sendData.id) {
      console.error('[Email Service] Gmail API message send failed:', sendData);
      throw new Error(sendData.error?.message || 'Failed to dispatch email via Gmail API');
    }

    console.log(`[Email Service] Real email sent via Gmail REST API: ID ${sendData.id}`);
    return {
      success: true,
      messageId: sendData.id
    };
  },

  /**
   * Dispatches email using SMTP if configured, otherwise falls back to local file recording for verification & dev previews.
   * @param {{ to: string, subject: string, body: string, html: string }} params
   */
  sendEmail: async ({ to, subject, body, html, smtpConfig }) => {
    console.log(`[Email Service] Dispatching email to: ${to}`);
    console.log(`[Email Service] Subject: ${subject}`);

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

    let activeHost = null;
    let activePort = null;
    let activeSecure = null;
    let activeUser = null;
    let activePass = null;
    let activeFrom = null;

    let isOAuth = false;
    let oauthUser = null;
    let oauthRefreshToken = null;

    // Check for Tenant Gmail OAuth configuration first
    if (smtpConfig && (smtpConfig.provider === 'gmail_oauth' || smtpConfig.gmailOAuth?.connected) && smtpConfig.gmailOAuth?.refreshToken) {
      isOAuth = true;
      oauthUser = smtpConfig.gmailOAuth.userEmail;
      oauthRefreshToken = smtpConfig.gmailOAuth.refreshToken;
      activeFrom = smtpConfig.fromName ? `"${smtpConfig.fromName}" <${oauthUser}>` : oauthUser;
    }

    if (isOAuth) {
      return await emailService.sendViaGmailOAuth({
        to,
        subject,
        body,
        html: htmlContent,
        oauthUser,
        oauthRefreshToken,
        fromName: smtpConfig?.fromName
      });
    }

    // Use tenant custom SMTP config if provided and valid
    if (smtpConfig && smtpConfig.provider && smtpConfig.provider !== 'none' && smtpConfig.user && smtpConfig.pass) {
      activeUser = smtpConfig.user;
      activePass = smtpConfig.pass;
      activeFrom = smtpConfig.fromName ? `"${smtpConfig.fromName}" <${activeUser}>` : activeUser;

      if (smtpConfig.provider === 'gmail') {
        activeHost = 'smtp.gmail.com';
        activePort = 587;
        activeSecure = false;
      } else if (smtpConfig.provider === 'outlook') {
        activeHost = 'smtp-mail.outlook.com';
        activePort = 587;
        activeSecure = false;
      } else if (smtpConfig.provider === 'yahoo') {
        activeHost = 'smtp.mail.yahoo.com';
        activePort = 587;
        activeSecure = false;
      } else if (smtpConfig.provider === 'custom') {
        activeHost = smtpConfig.host;
        activePort = parseInt(smtpConfig.port, 10) || 587;
        activeSecure = smtpConfig.secure === true;
      }
    }

    // Fallback to platform environment variables
    if (!activeHost && process.env.SMTP_HOST && process.env.SMTP_USER) {
      activeHost = process.env.SMTP_HOST;
      activePort = parseInt(process.env.SMTP_PORT, 10) || 587;
      activeSecure = process.env.SMTP_SECURE === 'true';
      activeUser = process.env.SMTP_USER;
      activePass = process.env.SMTP_PASS;
      activeFrom = process.env.SMTP_FROM_EMAIL || `"Invoice Platform" <${process.env.SMTP_USER}>`;
    }

    if (activeHost && activeUser && activePass) {
      try {
        const transporter = nodemailer.createTransport({
          host: activeHost,
          port: activePort,
          secure: activeSecure,
          auth: {
            user: activeUser,
            pass: activePass,
          },
        });

        const info = await transporter.sendMail({
          from: activeFrom,
          to,
          subject,
          text: body, // plaintext fallback
          html: htmlContent,
        });

        console.log(`[Email Service] Real email sent via SMTP: ${info.messageId}`);
        return {
          success: true,
          messageId: info.messageId
        };
      } catch (error) {
        console.error('[Email Service] Failed to send real email via SMTP:', error);
        throw error;
      }
    }

    // Fallback: Local file recording
    try {
      const sentEmailsDir = path.join(__dirname, '..', 'sent_emails');
      
      // Ensure the sent_emails directory exists
      if (!fs.existsSync(sentEmailsDir)) {
        fs.mkdirSync(sentEmailsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `email-${timestamp}.html`;
      const filePath = path.join(sentEmailsDir, filename);

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
