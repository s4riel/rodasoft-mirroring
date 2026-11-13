import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createTransport, Transporter } from 'nodemailer';
import { QUEUE } from '../common/queues';
import type { WorkerEnv } from '../config/env';

interface MailJob {
  outboxId: string;
  companyId: string | null;
  payload: Record<string, string>;
}

/** Transactional e-mails. In development they arrive at Mailpit: http://localhost:8025 */
@Processor(QUEUE.mail, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly transport: Transporter;

  constructor(private readonly config: ConfigService<WorkerEnv, true>) {
    super();
    this.transport = createTransport(this.config.get('SMTP_URL'));
  }

  async process(job: Job<MailJob>) {
    const p = job.data.payload;
    switch (job.name) {
      case 'auth.password-reset':
        await this.send(
          p['email'],
          'Restablece tu contraseña',
          `<p>Hola ${escapeHtml(p['name'])},</p>
           <p>Recibimos una solicitud para restablecer tu contraseña del ERP. El enlace vence en 30 minutos.</p>
           <p><a href="${p['url']}">Crear una contraseña nueva</a></p>
           <p>Si no la pediste, ignora este correo.</p>`,
        );
        break;
      case 'auth.invitation':
        await this.send(p['email'], 'Te invitaron al ERP', `<p><a href="${p['url']}">Aceptar la invitación</a></p>`);
        break;
      case 'sale.receipt-email':
        // HU-VEN-11: the API pre-renders the receipt text (no NIT, no costs); the worker only delivers it
        await this.send(
          p['email'],
          `Comprobante ${p['number']} · ${p['company']}`,
          `<p>${escapeHtml(p['text']).replace(/\n/g, '<br>')}</p>`,
        );
        break;
      case 'sales.quote-email':
        // HU-VEN-17: the API pre-renders the quote text (lines and total, no NIT, no costs); the worker only delivers it
        await this.send(
          p['email'],
          `Cotización ${p['number']} · ${p['company']}`,
          `<p>${escapeHtml(p['text']).replace(/\n/g, '<br>')}</p>`,
        );
        break;
      case 'invoice.email':
        // HU-FAC-06: the API renders the PDF and the XML (base64 in the payload); the worker only delivers them
        await this.send(
          p['email'],
          `Factura ${p['number']} · ${p['company']}`,
          `<p>Adjuntamos tu factura ${escapeHtml(p['number'])} de ${escapeHtml(p['company'])}, en PDF y XML.</p>`,
          [
            { filename: `factura-${p['number']}.pdf`, content: Buffer.from(p['pdfBase64'], 'base64'), contentType: 'application/pdf' },
            { filename: `factura-${p['number']}.xml`, content: Buffer.from(p['xmlBase64'], 'base64'), contentType: 'application/xml' },
          ],
        );
        break;
      default:
        this.logger.warn(`Unknown mail job: ${job.name}`);
    }
  }

  private async send(to: string, subject: string, html: string, attachments?: { filename: string; content: Buffer; contentType: string }[]) {
    await this.transport.sendMail({ from: this.config.get('MAIL_FROM'), to, subject, html, ...(attachments ? { attachments } : {}) });
    this.logger.log(`E-mail "${subject}" sent to ${to}`);
  }
}

const escapeHtml = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
