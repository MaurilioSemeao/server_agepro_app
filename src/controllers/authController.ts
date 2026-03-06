import { Request, Response } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
];

export const authController = {
    // Retorna a URL para redirecionar o usuário pro portal de login orgânico do Google
    getGoogleAuthUrl(req: Request, res: Response) {
        const { returnUrl } = req.query;
        console.log(`[AUTH] Iniciando tentativa de login Google. Return URL: ${returnUrl}`);

        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline', // Importante para receber Refresh Token
            scope: SCOPES,
            prompt: 'consent', // Força o consentimento para garantir o Refresh Token
            state: returnUrl ? String(returnUrl) : undefined
        });

        res.json({ url });
    },

    // Callback recepcionando o sucesso do Google
    async googleCallback(req: Request, res: Response) {
        const { code, state } = req.query;
        console.log(`[AUTH] Recebido callback do Google.`);

        try {
            // 1. Troca o código pelo token
            const { tokens } = await oauth2Client.getToken({ code: code as string });
            oauth2Client.setCredentials(tokens);

            // 2. Descobre quem é o Usuário
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();

            if (!userInfo.data.email) {
                return res.status(400).send('Email não fornecido pelo Google');
            }

            // 3. Cadastra ou Atualiza o Usuário no Banco (Prisma)
            let user = await prisma.user.findUnique({
                where: { email: userInfo.data.email }
            });

            if (!user) {
                user = await prisma.user.create({
                    data: {
                        email: userInfo.data.email,
                        name: userInfo.data.name,
                    }
                });
                console.log(`[AUTH] Novo usuário cadastrado: ${user.email}`);
            } else {
                console.log(`[AUTH] Usuário existente logado: ${user.email}`);
            }

            // 4. Salva ou Atualiza as credenciais (Integration) do Google
            const googleIntegration = await prisma.integration.findFirst({
                where: { userId: user.id, provider: 'GOOGLE' }
            });

            if (!googleIntegration) {
                await prisma.integration.create({
                    data: {
                        userId: user.id,
                        provider: 'GOOGLE',
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        status: 'CONNECTED'
                    }
                });
            } else {
                // Atualiza os tokens
                await prisma.integration.update({
                    where: { id: googleIntegration.id },
                    data: {
                        accessToken: tokens.access_token || googleIntegration.accessToken,
                        // Cuidado: Refresh Token só vem no primeiro consentimento ou se forçado
                        refreshToken: tokens.refresh_token || googleIntegration.refreshToken,
                        status: 'CONNECTED'
                    }
                });
            }

            // 5. Gera nosso próprio JWT para a sessão do App
            const appToken = jwt.sign(
                { id: user.id, email: user.email, name: user.name },
                process.env.JWT_SECRET || 'secret_jwt_app',
                { expiresIn: '30d' }
            );

            // 6. Redireciona via Deep Link para o React Native
            const baseUrl = (state as string) || 'exp://127.0.0.1:8081/--/login-success';
            const separator = baseUrl.includes('?') ? '&' : '?';
            const redirectUrl = `${baseUrl}${separator}status=success&token=${appToken}`;

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Login Concluído!</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; color: #1c1e21; }
                        .card { background: white; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 350px; width: 80%; }
                        h2 { color: #4285F4; margin-top: 0; }
                        a.button { display: inline-block; margin-top: 2rem; padding: 0.8rem 2rem; background-color: #4285F4; color: white; text-decoration: none; border-radius: 2rem; font-weight: bold; transition: background-color 0.2s; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Login Concluído!</h2>
                        <a href="${redirectUrl}" class="button">Voltar para o App</a>
                    </div>
                    <script>
                        window.location.href = "${redirectUrl}";
                    </script>
                </body>
                </html>
            `);
        } catch (error: any) {
            console.error('[AUTH] ERRO na autenticação Google:', error);
            res.status(500).send('Erro na autenticação: ' + (error.message || 'Erro interno'));
        }
    }
};
