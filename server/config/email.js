const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // App Password do Gmail
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  async sendBackupEmail(email, backupFilePath) {
    const fs = require('fs');
    const path = require('path');

    // Verificar se o arquivo existe
    if (!fs.existsSync(backupFilePath)) {
      throw new Error('Arquivo de backup não encontrado');
    }

    const fileName = path.basename(backupFilePath);
    const stats = fs.statSync(backupFilePath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
    const now = new Date();
    const dateFormatted = now.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `JIRA SENAC - Backup Automático - ${dateFormatted}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">JIRA</h1>
            <p style="color: white; margin: 10px 0 0 0;">Apontamento Inteligente</p>
          </div>

          <div style="padding: 30px; background: #f8f9fa;">
            <h2 style="color: #2C3E50;">🔒 Backup Automático</h2>
            <p style="color: #7F8C8D; line-height: 1.6;">
              Backup da base de dados gerado automaticamente em <strong>${dateFormatted}</strong>.
            </p>

            <div style="background: #e9ecef; padding: 20px; border-radius: 10px; margin: 20px 0;">
              <h3 style="color: #2C3E50; margin: 0 0 10px 0;">📊 Detalhes do Backup:</h3>
              <p style="margin: 5px 0; color: #7F8C8D;"><strong>Arquivo:</strong> ${fileName}</p>
              <p style="margin: 5px 0; color: #7F8C8D;"><strong>Tamanho:</strong> ${fileSizeMB} MB</p>
              <p style="margin: 5px 0; color: #7F8C8D;"><strong>Data/Hora:</strong> ${dateFormatted}</p>
            </div>

            <p style="color: #7F8C8D; line-height: 1.6;">
              O arquivo de backup está anexado a este e-mail. Mantenha-o em local seguro.
            </p>
          </div>

          <div style="padding: 20px; text-align: center; background: #e9ecef; color: #7F8C8D; font-size: 12px;">
            Este é um e-mail automático do sistema de backup.
          </div>
        </div>
      `,
      attachments: [
        {
          filename: fileName,
          path: backupFilePath,
          contentType: 'application/sql'
        }
      ]
    };

    return await this.transporter.sendMail(mailOptions);
  }
}

module.exports = new EmailService();