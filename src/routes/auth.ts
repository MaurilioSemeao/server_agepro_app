import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { sessionStore } from '../sessionStore';

const router = Router();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

console.log(`[AUTH] OAuth2 Client inicializado com Redirect URI: ${process.env.GOOGLE_REDIRECT_URI}`);

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
];

router.get('/google', (req: Request, res: Response) => {
    const { returnUrl } = req.query;
    console.log(`[AUTH] Iniciando tentativa de login Google em ${new Date().toISOString()}`);
    console.log(`[AUTH] Return URL fornecido pelo App: ${returnUrl}`);
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        state: returnUrl ? String(returnUrl) : undefined
    });
    res.json({ url });
});

router.get('/google/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    console.log(`[AUTH] Recebido callback do Google às ${new Date().toISOString()}`);
    console.log(`[AUTH] Estado recebido (Return URL): ${state}`);

    try {
        const { tokens } = await oauth2Client.getToken(code as string);
        oauth2Client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();

        // Salva na sessão ativa compartilhada
        sessionStore.activeSession = {
            user: userInfo.data,
            tokens: tokens
        };

        console.log(`[AUTH] Login bem-sucedido para: ${userInfo.data.email}`);

        // O state armazena a URL exata do Expo Go: ex: exp://192.168.100.203:8081/--/login-success
        const baseUrl = (state as string) || 'exp://127.0.0.1:8081/--/login-success';
        const separator = baseUrl.includes('?') ? '&' : '?';
        const redirectUrl = `${baseUrl}${separator}status=success&token=${sessionStore.TOKEN}`;

        // Enviamos uma página HTML como "ponte" para garantir que o Deep Link funcione em todos os navegadores mobile
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Autenticação Concluída</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; color: #1c1e21; }
                    .card { background: white; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 350px; width: 80%; }
                    h2 { color: #4285F4; margin-top: 0; }
                    p { line-height: 1.5; color: #606770; }
                    .button { display: inline-block; margin-top: 2rem; padding: 0.8rem 2rem; background-color: #4285F4; color: white; text-decoration: none; border-radius: 2rem; font-weight: bold; transition: background-color 0.2s; }
                    .button:active { background-color: #357abd; }
                    .loader { border: 3px solid #f3f3f3; border-top: 3px solid #4285F4; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 1.5rem auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Login Concluído!</h2>
                    <div class="loader"></div>
                    <p>Redirecionando você de volta para o aplicativo...</p>
                    <a href="${redirectUrl}" class="button">Abrir Aplicativo</a>
                </div>
                <script>
                    // Tenta o redirecionamento automático imediatamente
                    window.location.href = "${redirectUrl}";
                    
                    // Fallback para navegadores que bloqueiam redirecionamento automático
                    setTimeout(() => {
                        console.log("Se não redirecionou, clique no botão.");
                    }, 2000);
                </script>
            </body>
            </html>
        `);
    } catch (error: any) {
        // Se já tiver uma sessão e for erro de "invalid_grant" (provavelmente refresh), redireciona mesmo assim
        if (sessionStore.activeSession && error?.response?.data?.error === 'invalid_grant') {
            console.log('[AUTH] Refresh detectado com sessão já ativa. Redirecionando...');
            const baseUrl = (state as string) || 'exp://127.0.0.1:8081/--/login-success';
            const separator = baseUrl.includes('?') ? '&' : '?';
            return res.redirect(`${baseUrl}${separator}status=success&token=${sessionStore.TOKEN}`);
        }

        console.error('[AUTH] ERRO na autenticação Google:', error);
        res.status(500).send('Erro na autenticação: ' + (error.message || 'Erro interno'));
    }
});

router.get('/me', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token === sessionStore.TOKEN && sessionStore.activeSession) {
        res.json(sessionStore.activeSession.user);
    } else {
        res.status(401).json({ message: 'User not authenticated' });
    }
});

router.get('/logout', (req: Request, res: Response) => {
    sessionStore.activeSession = null;
    res.json({ message: 'Logged out' });
});

export default router;
