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

describe('MailProcessor · invoice.email (HU-FAC-06)', () => {
  const sendMail = jest.fn().mockResolvedValue({});

  it('delivers the invoice with its PDF and XML attached', async () => {
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const config = { get: (key: string) => (key === 'MAIL_FROM' ? 'facturas@rodalaser.test' : 'smtp://localhost') } as unknown as ConfigService<never, true>;
    const payload = { email: 'ana@demo.test', number: '000012', company: 'RODALASER', pdfBase64: Buffer.from('%PDF-1.4').toString('base64'), xmlBase64: Buffer.from('<x/>').toString('base64') };
    await new MailProcessor(config).process({ name: 'invoice.email', data: { outboxId: '1', companyId: 'c', payload } } as unknown as Job);

    const sent = sendMail.mock.calls.at(-1)?.[0];
    expect(sent).toMatchObject({ from: 'facturas@rodalaser.test', to: 'ana@demo.test', subject: 'Factura 000012 · RODALASER' });
    expect(sent.attachments).toHaveLength(2);
    expect(sent.attachments[0]).toMatchObject({ filename: 'factura-000012.pdf', contentType: 'application/pdf' });
    expect(sent.attachments[0].content.toString()).toBe('%PDF-1.4');
    expect(sent.attachments[1]).toMatchObject({ filename: 'factura-000012.xml', contentType: 'application/xml' });
    expect(sent.attachments[1].content.toString()).toBe('<x/>');
  });
});
