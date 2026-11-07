import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { MailProcessor } from './mail.processor';

jest.mock('nodemailer');

describe('MailProcessor · sales.quote-email (HU-VEN-17)', () => {
  const sendMail = jest.fn().mockResolvedValue({});

  function processor() {
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const config = { get: (key: string) => (key === 'MAIL_FROM' ? 'ventas@rodalaser.test' : 'smtp://localhost') } as unknown as ConfigService<never, true>;
    return new MailProcessor(config);
  }
  const job = (payload: Record<string, string>) => ({ name: 'sales.quote-email', data: { outboxId: '1', companyId: 'c', payload } }) as unknown as Job;

  it('delivers the quote text to the customer with the number in the subject, escaped and with line breaks', async () => {
    await processor().process(job({ email: 'ana@demo.test', number: 'COT-000001', company: 'RODALASER', text: 'Hola <b>Ana</b>\nTotal: Bs 200,00' }) as never);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'ventas@rodalaser.test',
      to: 'ana@demo.test',
      subject: 'Cotización COT-000001 · RODALASER',
      html: '<p>Hola &lt;b&gt;Ana&lt;/b&gt;<br>Total: Bs 200,00</p>',
    });
  });
});
