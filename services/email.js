const nodemailer = require('nodemailer');

// Transporter em cache. `null` = ainda não inicializado, `false` = sem config.
let transporter = null;

function buildTransporter() {
    const {
        EMAIL_USER, EMAIL_PASS,
        SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE
    } = process.env;

    // Opção 1: SMTP genérico (qualquer provedor)
    if (SMTP_HOST) {
        const port = parseInt(SMTP_PORT, 10) || 587;
        return nodemailer.createTransport({
            host: SMTP_HOST,
            port,
            secure: SMTP_SECURE ? SMTP_SECURE === 'true' : port === 465,
            auth: (SMTP_USER || EMAIL_USER)
                ? { user: SMTP_USER || EMAIL_USER, pass: SMTP_PASS || EMAIL_PASS }
                : undefined
        });
    }

    // Opção 2: Gmail com "senha de app"
    if (EMAIL_USER && EMAIL_PASS) {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });
    }

    // Sem configuração de email
    return false;
}

function getTransporter() {
    if (transporter === null) {
        transporter = buildTransporter();
    }
    return transporter;
}

function isEmailConfigured() {
    return !!getTransporter();
}

function getFromAddress() {
    return process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@ghosts';
}

// Mascara o email para exibir sem vazar o endereço completo: wi***@gmail.com
function maskEmail(email) {
    const str = String(email || '');
    const at = str.indexOf('@');
    if (at <= 0) return str;
    const user = str.slice(0, at);
    const domain = str.slice(at);
    const visible = user.slice(0, Math.min(2, user.length));
    return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}${domain}`;
}

async function sendPasswordResetEmail(to, name, code) {
    const t = getTransporter();
    if (!t) throw new Error('Email não configurado');

    const safeName = String(name || 'membro');
    const subject = 'Código de recuperação de senha - Ghosts';
    const text = `Olá ${safeName},\n\n`
        + `Você (ou alguém) pediu a recuperação da sua senha no Ghosts Farm Control.\n\n`
        + `Seu código de recuperação é: ${code}\n\n`
        + `Use este código na tela de login, no passo "Já tenho um código", para definir uma nova senha.\n\n`
        + `Se você não pediu isso, apenas ignore este email.`;

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;background:#12121f;border-radius:14px;overflow:hidden;border:1px solid #2a2a4a;">
            <div style="background:linear-gradient(135deg,#6c5ce7,#4b3fc0);padding:22px 24px;">
                <div style="font-size:20px;font-weight:800;color:#fff;">👻 Ghosts Farm Control</div>
            </div>
            <div style="padding:24px;color:#e5e7eb;">
                <p style="margin:0 0 12px;">Olá <b>${safeName}</b>,</p>
                <p style="margin:0 0 16px;line-height:1.5;">Recebemos um pedido para recuperar a sua senha. Use o código abaixo na tela de login:</p>
                <div style="text-align:center;margin:18px 0;">
                    <div style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:8px;color:#fff;background:#1a1a2e;border:1px solid #6c5ce7;border-radius:12px;padding:14px 22px;">${code}</div>
                </div>
                <p style="margin:16px 0 0;line-height:1.5;color:#9aa0b5;font-size:13px;">Abra o site, clique em <b>“Esqueci minha senha” &rarr; “Já tenho um código”</b>, informe este código e escolha a nova senha.</p>
                <p style="margin:14px 0 0;line-height:1.5;color:#9aa0b5;font-size:13px;">Se você não pediu isso, é só ignorar este email.</p>
            </div>
        </div>
    `;

    return await t.sendMail({
        from: `"Ghosts Farm Control" <${getFromAddress()}>`,
        to,
        subject,
        text,
        html
    });
}

async function sendTestEmail(to) {
    const t = getTransporter();
    if (!t) throw new Error('Email não configurado (defina EMAIL_USER/EMAIL_PASS ou SMTP_* no servidor)');
    return await t.sendMail({
        from: `"Ghosts Farm Control" <${getFromAddress()}>`,
        to,
        subject: '✅ Teste de email - Ghosts Farm Control',
        text: 'Funcionou! Este é um email de teste do Ghosts Farm Control. Se você recebeu isto, o envio de emails (e a recuperação de senha) está funcionando.',
        html: `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:0 auto;background:#12121f;border-radius:14px;overflow:hidden;border:1px solid #2a2a4a;">
                <div style="background:linear-gradient(135deg,#27ae60,#1e8449);padding:20px 24px;">
                    <div style="font-size:18px;font-weight:800;color:#fff;">✅ Email funcionando!</div>
                </div>
                <div style="padding:22px 24px;color:#e5e7eb;line-height:1.5;">
                    <p style="margin:0 0 10px;">Este é um <b>email de teste</b> do 👻 Ghosts Farm Control.</p>
                    <p style="margin:0;color:#9aa0b5;font-size:14px;">Se você recebeu esta mensagem, o envio de emails está configurado corretamente e a recuperação de senha por email vai funcionar.</p>
                </div>
            </div>
        `
    });
}

module.exports = { isEmailConfigured, sendPasswordResetEmail, sendTestEmail, maskEmail };
