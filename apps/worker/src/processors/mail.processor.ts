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
      default:
        this.logger.warn(`Unknown mail job: ${job.name}`);
    }
  }

  private async send(to: string, subject: string, html: string) {
    await this.transport.sendMail({ from: this.config.get('MAIL_FROM'), to, subject, html });
    this.logger.log(`E-mail "${subject}" sent to ${to}`);
  }
}

const escapeHtml = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
