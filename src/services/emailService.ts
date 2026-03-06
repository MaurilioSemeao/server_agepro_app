import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

async function getTransporter() {
    if (transporter) return transporter;

    if (process.env.SMTP_HOST && process.env.SMTP_PASS) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    } else {
        console.log('[EMAIL] Conta SMTP não fornecida. Gerando conta temporária Ethereal (Sandbox)...');
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass,
            },
        });
    }
    return transporter;
}

export const emailService = {
    async sendQRCodeLink(toEmail: string, linkUrl: string) {
        try {
            const mailOptions = {
                from: '"Calendar Messenger Manager" <no-reply@seuapp.com>',
                to: toEmail,
                subject: 'Conecte seu WhatsApp ao App',
                html: `
                    <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
                        <h2>Conexão do WhatsApp Solicitada</h2>
                        <p>Você solicitou a conexão do seu WhatsApp com o nosso sistema.</p>
                        <p>Para concluir, abra o link abaixo no seu computador e escaneie o QR Code com o aplicativo do WhatsApp no seu celular:</p>
                        <br/>
                        <a href="${linkUrl}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            VER QR CODE DE CONEXÃO
                        </a>
                        <br/><br/>
                        <p style="color: #888; font-size: 12px;">Se você não solicitou isso, ignore este e-mail.</p>
                    </div>
                `,
            };

            const mailTransporter = await getTransporter();
            const info = await mailTransporter.sendMail(mailOptions);
            console.log(`[EMAIL] Link do QR Code enviado para ${toEmail} | MessageID: ${info.messageId}`);

            const testUrl = nodemailer.getTestMessageUrl(info);
            if (testUrl) {
                console.log(`[EMAIL-TESTE] 📩 VEJA O E-MAIL AQUI: ${testUrl}`);
            }

            return true;
        } catch (error) {
            console.error('[EMAIL] Erro ao enviar email do QR Code:', error);
            throw error;
        }
    }
};
