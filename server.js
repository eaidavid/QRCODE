import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import QRCode from 'qrcode';
import { z } from 'zod';

import { accounts } from './data/accounts.js';
import { verifyPassword } from './lib/password.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const port = Number(process.env.PORT || 3000);

const SESSION_COOKIE = 'panel_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_DEPOSIT_CENTS = 100;
const MAX_DEPOSIT_CENTS = 1_500_000;

const gatewayKey = readEnv('ACCESS_KEY', 'GATEWAY_API_KEY', 'PODPAY_API_KEY');
const gatewayMode = readEnv('APP_MODE', 'GATEWAY_ENV', 'PODPAY_ENV');
const gatewayEnv = gatewayMode === 'live' ? 'live' : 'sandbox';
const baseUrl =
  readEnv('REMOTE_URL', 'GATEWAY_BASE_URL', 'PODPAY_BASE_URL') ||
  (gatewayEnv === 'live' ? 'https://api.podpay.app' : 'https://sandbox.podpay.app');
const sessionSecret = readEnv('APP_SECRET', 'SESSION_SECRET') || 'troque-este-segredo-local';
const appUrl = readEnv('APP_URL', 'PUBLIC_URL');
const webhookSecret = readEnv('WEBHOOK_SECRET', 'PODPAY_WEBHOOK_SECRET');
const defaultProfile = readDefaultProfile();
const chargeStoreFile = path.join(__dirname, 'data', 'charges.json');

const chargeCache = loadChargeCache();
const webhookEvents = new Map();

const publicDir = path.join(__dirname, 'public');
const viewsDir = path.join(__dirname, 'views');

const contentSecurityPolicy = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: gatewayEnv === 'live' ? [] : null
  }
};

const loginSchema = z.object({
  login: z.string().trim().min(3).max(64),
  password: z.string().min(6).max(120)
});

const checkoutSchema = z
  .object({
    amount: z.union([z.number(), z.string()])
  })
  .superRefine((data, ctx) => {
    const cents = parseAmountToCents(data.amount);

    if (!cents || cents < MIN_DEPOSIT_CENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O valor minimo para pagamento e R$ 1,00.',
        path: ['amount']
      });
    }

    if (cents > MAX_DEPOSIT_CENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O valor maximo por deposito e R$ 15.000,00.',
        path: ['amount']
      });
    }
  });

const webhookSchema = z
  .object({
    event: z.string().trim().min(1),
    eventId: z.string().trim().min(1),
    timestamp: z.string().trim().min(1).optional(),
    source: z.string().trim().optional(),
    metadata: z
      .object({
        idempotencyKey: z.string().trim().optional()
      })
      .partial()
      .optional(),
    data: z
      .object({
        id: z.string().trim().min(1),
        amount: z.number().int().nonnegative().optional(),
        status: z.string().trim().optional(),
        createdAt: z.string().trim().nullable().optional(),
        paidAt: z.string().trim().nullable().optional(),
        paymentMethod: z.string().trim().optional(),
        description: z.string().nullable().optional()
      })
      .passthrough()
  })
  .passthrough();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy
  })
);
app.use(
  express.json({
    limit: '20kb',
    verify: captureRawBody
  })
);
app.use(attachSession);
app.use(applySecurityHeaders);
app.use(
  '/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
      }
    }
  })
);
app.use(
  '/checkout',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Muitas tentativas. Aguarde alguns segundos e tente novamente.'
      }
    }
  })
);
app.use('/health', requireLocalAccess);
app.use(express.static(publicDir, { extensions: ['html'], index: false }));

app.get('/', (req, res) => {
  res.redirect(req.account ? '/painel' : '/login');
});

app.get('/login', (req, res) => {
  if (req.account) {
    return res.redirect('/painel');
  }

  return res.sendFile(path.join(viewsDir, 'login.html'));
});

app.get('/painel', requirePageAuth, (_req, res) => {
  res.sendFile(path.join(viewsDir, 'checkout.html'));
});

app.get('/return/notify', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ready'
    }
  });
});

app.get('/auth/session', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      login: req.account.login,
      label: req.account.label || req.account.login
    }
  });
});

app.post('/auth/login', requireSameOrigin, async (req, res) => {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Informe login e senha validos.'
      }
    });
  }

  const login = result.data.login.trim().toLowerCase();
  const account = findAccountByLogin(login);

  if (!account || account.active === false) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Login ou senha incorretos.'
      }
    });
  }

  const passwordMatches = await verifyPassword(result.data.password, account.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Login ou senha incorretos.'
      }
    });
  }

  const token = createSession(account.id);
  setCookie(res, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: shouldUseSecureCookie(req),
    path: '/',
    maxAge: SESSION_TTL_MS
  });

  return res.json({
    success: true,
    data: {
      login: account.login,
      label: account.label || account.login,
      redirectTo: '/painel'
    }
  });
});

app.post('/auth/logout', requireSameOrigin, (req, res) => {
  clearCookie(res, SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: shouldUseSecureCookie(req),
    path: '/'
  });

  res.json({ success: true });
});

app.post('/return/notify', (req, res) => {
  const signatureError = verifyWebhookSignature(req);

  if (signatureError) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_SIGNATURE',
        message: signatureError
      }
    });
  }

  const result = webhookSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_WEBHOOK',
        message: 'Payload de webhook invalido.'
      }
    });
  }

  const event = result.data;

  if (wasWebhookProcessed(event.eventId)) {
    return res.json({ success: true, data: { duplicated: true } });
  }

  rememberWebhookEvent(event.eventId);
  rememberCharge(buildChargeFromWebhook(event));

  return res.json({ success: true });
});

app.post('/checkout/create', requireAuth, requireSameOrigin, async (req, res) => {
  const result = checkoutSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: result.error.issues[0]?.message || 'Dados invalidos.'
      }
    });
  }

  if (!gatewayKey) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'CONFIG_ERROR',
        message: 'A cobranca nao esta configurada no momento.'
      }
    });
  }

  const chargeProfile = resolveChargeProfile(req.account);
  const profileError = getChargeProfileError(chargeProfile);

  if (profileError) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'CONFIG_ERROR',
        message: profileError
      }
    });
  }

  const payload = buildChargePayload(result.data.amount, chargeProfile);

  try {
    const gatewayResponse = await requestGateway('/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify(payload)
    });

    const charge = attachChargeOwner(await mapCharge(gatewayResponse.data, gatewayResponse.meta), req.account);
    rememberCharge(charge);

    return res.json({ success: true, data: charge });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: {
        code: error.code || 'SERVICE_ERROR',
        message: error.message || 'Nao foi possivel gerar o codigo agora.'
      }
    });
  }
});

app.get('/checkout/status/:reference', requireAuth, async (req, res) => {
  const reference = String(req.params.reference || '').trim();

  if (!reference) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REFERENCE',
        message: 'Informe uma referencia valida.'
      }
    });
  }

  const cachedCharge = chargeCache.get(reference) || null;

  if (cachedCharge && !canAccessCharge(req.account, cachedCharge)) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Cobranca nao encontrada.'
      }
    });
  }

  if (!gatewayKey) {
    if (cachedCharge) {
      return res.json({ success: true, data: cachedCharge });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'CONFIG_ERROR',
        message: 'A consulta nao esta disponivel no momento.'
      }
    });
  }

  try {
    const gatewayResponse = await requestGateway(`/v1/transactions/${encodeURIComponent(reference)}`);
    const charge = attachChargeOwner(await mapCharge(gatewayResponse.data, gatewayResponse.meta), req.account, cachedCharge);
    rememberCharge(charge);

    return res.json({ success: true, data: charge });
  } catch (error) {
    if (cachedCharge) {
      return res.json({ success: true, data: cachedCharge });
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      error: {
        code: error.code || 'SERVICE_ERROR',
        message: error.message || 'Nao foi possivel atualizar o status.'
      }
    });
  }
});

app.get('/checkout/statement', requireAuth, (req, res) => {
  const filters = readStatementFilters(req.query || {});
  const charges = filterCharges(listChargesForAccount(req.account), filters);

  return res.json({
    success: true,
    data: {
      filters,
      items: charges,
      summary: {
        totalCount: charges.length,
        paidCount: charges.filter((charge) => charge.state === 'paid').length,
        totalGeneratedCents: charges.reduce((sum, charge) => sum + Number(charge.amountCents || 0), 0),
        totalPaidCents: charges.filter((charge) => charge.state === 'paid').reduce((sum, charge) => sum + Number(charge.amountCents || 0), 0)
      }
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      env: gatewayEnv,
      authConfigured: Boolean(sessionSecret),
      accountCount: accounts.filter((account) => account.active !== false).length,
      checkoutConfigured: Boolean(gatewayKey),
      webhookUrl: getWebhookUrl(),
      webhookSecretConfigured: Boolean(webhookSecret)
    }
  });
});

app.use((_req, res) => {
  res.status(404).send('Nao encontrado.');
});

app.listen(port, () => {
  console.log(`Servidor iniciado em http://localhost:${port}`);
});

function captureRawBody(req, _res, buffer) {
  if (buffer && buffer.length) {
    req.rawBody = buffer.toString('utf8');
  }
}

function attachSession(req, _res, next) {
  pruneWebhookEvents();

  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return next();
  }

  const session = verifySessionToken(token);

  if (!session) {
    return next();
  }

  const account = findAccountById(session.accountId);

  if (!account || account.active === false) {
    return next();
  }

  req.session = session;
  req.account = account;
  next();
}

function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  if (req.path === '/login' || req.path === '/painel' || req.path.startsWith('/auth') || req.path.startsWith('/checkout')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}

function requireSameOrigin(req, res, next) {
  const source = String(req.headers.origin || req.headers.referer || '').trim();

  if (!source) {
    return next();
  }

  try {
    const sourceUrl = new URL(source);
    const host = String(req.headers.host || '').trim().toLowerCase();
    const allowedOrigins = new Set([`${req.protocol}://${host}`.toLowerCase()]);

    if (appUrl) {
      allowedOrigins.add(new URL(appUrl).origin.toLowerCase());
    }

    if (!allowedOrigins.has(sourceUrl.origin.toLowerCase())) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Origem da requisicao nao autorizada.'
        }
      });
    }
  } catch {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Origem da requisicao nao autorizada.'
      }
    });
  }

  return next();
}

function requireLocalAccess(req, res, next) {
  const ip = String(req.ip || '').replace(/^::ffff:/, '');

  if (ip === '127.0.0.1' || ip === '::1') {
    return next();
  }

  return res.status(404).send('Nao encontrado.');
}

function verifyWebhookSignature(req) {
  if (!webhookSecret) {
    return '';
  }

  const signatureHeader = String(req.headers['x-podpay-signature'] || '').trim();
  const timestamp = String(req.headers['x-webhook-timestamp'] || '').trim();

  if (!signatureHeader || !timestamp || !req.rawBody) {
    return 'Assinatura ausente ou incompleta.';
  }

  const providedSignature = signatureHeader.replace(/^sha256=/i, '');
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp} ${req.rawBody}`)
    .digest('hex');

  const providedBuffer = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (!providedBuffer.length || providedBuffer.length !== expectedBuffer.length) {
    return 'Assinatura invalida.';
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer) ? '' : 'Assinatura invalida.';
}

function wasWebhookProcessed(eventId) {
  return webhookEvents.has(eventId);
}

function rememberWebhookEvent(eventId) {
  webhookEvents.set(eventId, Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function pruneWebhookEvents() {
  const now = Date.now();

  for (const [eventId, expiresAt] of webhookEvents.entries()) {
    if (expiresAt <= now) {
      webhookEvents.delete(eventId);
    }
  }
}

function requireAuth(req, res, next) {
  if (!req.account) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Acesso indisponivel.'
      }
    });
  }

  return next();
}

function requirePageAuth(req, res, next) {
  if (!req.account) {
    return res.redirect('/login');
  }

  return next();
}

function createSession(accountId) {
  return signSessionToken({
    accountId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
}

function signSessionToken(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  const lastDot = token.lastIndexOf('.');

  if (lastDot <= 0) {
    return '';
  }

  const payload = token.slice(0, lastDot);
  const receivedSignature = token.slice(lastDot + 1);
  const expectedSignature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const receivedBuffer = Buffer.from(receivedSignature, 'hex');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (!session?.accountId || !session?.expiresAt || session.expiresAt <= Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};

  for (const item of cookieHeader.split(';')) {
    const trimmed = item.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function setCookie(res, name, value, options = {}) {
  const serialized = serializeCookie(name, value, options);
  const current = res.getHeader('Set-Cookie');

  if (!current) {
    res.setHeader('Set-Cookie', serialized);
    return;
  }

  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, serialized]);
    return;
  }

  res.setHeader('Set-Cookie', [current, serialized]);
}

function clearCookie(res, name, options = {}) {
  setCookie(res, name, '', {
    ...options,
    maxAge: 0
  });
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path || '/'}`);

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`);
  }

  return parts.join('; ');
}

function shouldUseSecureCookie(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const host = String(req.headers.host || '').trim().toLowerCase();
  const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');

  if (req.secure || forwardedProto === 'https') {
    return true;
  }

  return gatewayEnv === 'live' && !isLocalHost;
}

function loadChargeCache() {
  try {
    if (!fs.existsSync(chargeStoreFile)) {
      return new Map();
    }

    const payload = JSON.parse(fs.readFileSync(chargeStoreFile, 'utf8'));
    const items = Array.isArray(payload) ? payload : [];
    return new Map(items.filter((item) => item?.reference).map((item) => [item.reference, item]));
  } catch {
    return new Map();
  }
}

function persistCharges() {
  try {
    fs.writeFileSync(chargeStoreFile, JSON.stringify([...chargeCache.values()], null, 2));
  } catch (error) {
    console.error('Falha ao salvar extrato local:', error);
  }
}

function findAccountById(accountId) {
  return accounts.find((account) => account.id === accountId) || null;
}

function findAccountByLogin(login) {
  return accounts.find((account) => account.login.toLowerCase() === login.toLowerCase()) || null;
}

function resolveChargeProfile(account) {
  return {
    ...defaultProfile,
    ...(account.profile || {})
  };
}

function rememberCharge(charge) {
  if (!charge?.reference) {
    return;
  }

  const previous = chargeCache.get(charge.reference);

  chargeCache.set(charge.reference, {
    ...(previous || {}),
    ...charge,
    code: charge.code || previous?.code || '',
    image: charge.image || previous?.image || null,
    createdAt: charge.createdAt || previous?.createdAt || null,
    expiresAt: charge.expiresAt || previous?.expiresAt || null,
    paidAt: charge.paidAt || previous?.paidAt || null,
    requestId: charge.requestId || previous?.requestId || null,
    lastEvent: charge.lastEvent || previous?.lastEvent || null,
    lastEventId: charge.lastEventId || previous?.lastEventId || null,
    accountId: charge.accountId || previous?.accountId || '',
    accountLogin: charge.accountLogin || previous?.accountLogin || '',
    accountLabel: charge.accountLabel || previous?.accountLabel || '',
    updatedAt: charge.updatedAt || new Date().toISOString()
  });

  persistCharges();
}

function buildChargeFromWebhook(event) {
  return {
    reference: event.data.id,
    state: normalizeState(event.data.status || event.event),
    amountCents: Number(event.data.amount || 0),
    amountFormatted: formatCents(Number(event.data.amount || 0)),
    code: '',
    image: null,
    createdAt: event.data.createdAt || null,
    expiresAt: null,
    paidAt: event.data.paidAt || null,
    requestId: event.metadata?.idempotencyKey || null,
    lastEvent: event.event,
    lastEventId: event.eventId,
    updatedAt: event.timestamp || new Date().toISOString()
  };
}

function attachChargeOwner(charge, account, previousCharge = null) {
  return {
    ...(previousCharge || {}),
    ...charge,
    accountId: account?.id || previousCharge?.accountId || '',
    accountLogin: account?.login || previousCharge?.accountLogin || '',
    accountLabel: account?.label || account?.login || previousCharge?.accountLabel || previousCharge?.accountLogin || ''
  };
}

function canAccessCharge(account, charge) {
  return Boolean(account?.id && charge?.accountId && account.id === charge.accountId);
}

function listChargesForAccount(account) {
  return [...chargeCache.values()]
    .filter((charge) => canAccessCharge(account, charge))
    .sort((left, right) => {
      const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
      const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
      return rightTime - leftTime;
    });
}

function readStatementFilters(query) {
  return {
    status: String(query.status || '').trim().toLowerCase(),
    from: normalizeDateInput(query.from, 'start'),
    to: normalizeDateInput(query.to, 'end'),
    minAmountCents: parseFilterAmount(query.minAmount),
    maxAmountCents: parseFilterAmount(query.maxAmount),
    reference: String(query.reference || '').trim().toLowerCase()
  };
}

function filterCharges(charges, filters) {
  return charges.filter((charge) => {
    const status = String(charge.state || '').toLowerCase();
    const reference = String(charge.reference || '').toLowerCase();
    const amountCents = Number(charge.amountCents || 0);
    const createdAt = Date.parse(charge.createdAt || charge.updatedAt || 0) || 0;

    if (filters.status && status !== filters.status) {
      return false;
    }

    if (filters.reference && !reference.includes(filters.reference)) {
      return false;
    }

    if (filters.minAmountCents && amountCents < filters.minAmountCents) {
      return false;
    }

    if (filters.maxAmountCents && amountCents > filters.maxAmountCents) {
      return false;
    }

    if (filters.from && createdAt < filters.from) {
      return false;
    }

    if (filters.to && createdAt > filters.to) {
      return false;
    }

    return true;
  });
}

function normalizeDateInput(value, mode = 'start') {
  const raw = String(value || '').trim();

  if (!raw) {
    return 0;
  }

  const suffix = mode === 'end' ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const date = new Date(`${raw}${suffix}`);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }

  return date.getTime();
}

function parseFilterAmount(value) {
  const cents = parseAmountToCents(value);
  return cents > 0 ? cents : 0;
}

function normalizeState(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

  const aliases = {
    completed: 'paid',
    canceled: 'cancelled',
    cancelled: 'cancelled',
    pending: 'pending',
    processing: 'processing',
    paid: 'paid',
    failed: 'failed',
    blocked: 'blocked',
    refunded: 'refunded',
    pre_chargeback: 'pre_chargeback',
    chargeback: 'chargeback',
    'transaction.pending': 'pending',
    'transaction.completed': 'paid',
    'transaction.failed': 'failed',
    'transaction.refunded': 'refunded'
  };

  return aliases[normalized] || normalized || 'pending';
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function parseAmountToCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  let normalized = String(value || '')
    .trim()
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '');

  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100);
}

function buildChargePayload(amountValue, profile) {
  const amount = parseAmountToCents(amountValue);

  return {
    paymentMethod: 'pix',
    amount,
    customer: {
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      document: {
        type: profile.documentType,
        number: profile.documentNumber
      }
    },
    items: [
      {
        title: profile.title,
        unitPrice: amount,
        quantity: 1,
        tangible: false
      }
    ],
    ...(readPostbackUrl() ? { postbackUrl: readPostbackUrl() } : {})
  };
}

async function requestGateway(endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'x-api-key': gatewayKey,
      ...options.headers
    },
    body: options.body
  });

  const payload = await safeJson(response);

  if (!response.ok || payload?.success === false) {
    const message = payload?.error?.message || payload?.message || 'Nao foi possivel concluir a solicitacao.';

    const error = new Error(message);
    error.statusCode = response.status || 502;
    error.code = payload?.error?.code || 'SERVICE_ERROR';
    throw error;
  }

  return payload;
}

async function safeJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: text || 'Resposta invalida recebida do servico.'
      }
    };
  }
}

async function mapCharge(data = {}, meta = {}) {
  const transaction = unwrapChargePayload(data);
  const code = readChargeCode(transaction);
  const image = normalizeImageSource(readChargeImage(transaction)) || (code ? await generateQrDataUrl(code) : null);

  return {
    reference: readChargeReference(transaction),
    state: normalizeState(readChargeStatus(transaction) || 'pending'),
    amountCents: Number(readChargeAmount(transaction) || 0),
    amountFormatted: formatCents(Number(readChargeAmount(transaction) || 0)),
    code,
    image,
    createdAt: readChargeCreatedAt(transaction),
    expiresAt: readChargeExpiresAt(transaction),
    paidAt: readChargePaidAt(transaction),
    requestId: meta.requestId || null,
    lastEvent: null,
    lastEventId: null,
    updatedAt: new Date().toISOString()
  };
}

function unwrapChargePayload(data) {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const direct = data.data || data.transaction || data.charge || data.result || data.response || data;

  if (Array.isArray(direct)) {
    return direct[0] || {};
  }

  if (Array.isArray(direct?.transactions)) {
    return direct.transactions[0] || direct;
  }

  if (Array.isArray(direct?.charges)) {
    return direct.charges[0] || direct;
  }

  return direct;
}

function readChargeCode(data) {
  return (
    readFirstString(data, [
      'pixQrCode',
      'pix_qr_code',
      'pixCode',
      'pix_code',
      'qrCode',
      'qr_code',
      'copyPaste',
      'copy_paste',
      'emv',
      'brCode',
      'br_code',
      'payload'
    ]) ||
    readNestedString(data, [
      ['pix', 'copyPaste'],
      ['pix', 'copy_paste'],
      ['pix', 'emv'],
      ['pix', 'qrCode'],
      ['pix', 'qr_code'],
      ['pix', 'payload'],
      ['paymentMethodData', 'pix', 'copyPaste'],
      ['paymentMethodData', 'pix', 'copy_paste'],
      ['paymentMethodData', 'pix', 'emv'],
      ['paymentMethodData', 'pix', 'qrCode'],
      ['paymentMethodData', 'pix', 'qr_code'],
      ['paymentMethodData', 'pix', 'payload'],
      ['payment_method_data', 'pix', 'copyPaste'],
      ['payment_method_data', 'pix', 'copy_paste'],
      ['payment_method_data', 'pix', 'emv'],
      ['payment_method_data', 'pix', 'qrCode'],
      ['payment_method_data', 'pix', 'qr_code'],
      ['payment_method_data', 'pix', 'payload'],
      ['paymentMethod', 'pix', 'copyPaste'],
      ['paymentMethod', 'pix', 'copy_paste'],
      ['paymentMethod', 'pix', 'emv'],
      ['paymentMethod', 'pix', 'qrCode'],
      ['paymentMethod', 'pix', 'qr_code'],
      ['paymentMethod', 'pix', 'payload'],
      ['payment_method', 'pix', 'copyPaste'],
      ['payment_method', 'pix', 'copy_paste'],
      ['payment_method', 'pix', 'emv'],
      ['payment_method', 'pix', 'qrCode'],
      ['payment_method', 'pix', 'qr_code'],
      ['payment_method', 'pix', 'payload'],
      ['qr', 'copyPaste'],
      ['qr', 'copy_paste'],
      ['qr', 'emv'],
      ['qr', 'payload'],
      ['pixData', 'copyPaste'],
      ['pixData', 'copy_paste'],
      ['pixData', 'emv'],
      ['pixData', 'qrCode'],
      ['pixData', 'qr_code'],
      ['pix_data', 'copyPaste'],
      ['pix_data', 'copy_paste'],
      ['pix_data', 'emv'],
      ['pix_data', 'qrCode'],
      ['pix_data', 'qr_code']
    ]) ||
    findNestedStringByKey(data, ['pixqrcode', 'pixcode', 'qrcode', 'copypaste', 'emv', 'brcode', 'payload']) ||
    ''
  );
}

function readChargeImage(data) {
  return (
    readFirstString(data, ['pixQrCodeImage', 'pix_qr_code_image', 'qrCodeImage', 'qr_code_image', 'qrImage', 'qr_image', 'image']) ||
    readNestedString(data, [
      ['pix', 'qrCodeImage'],
      ['pix', 'qr_code_image'],
      ['pix', 'image'],
      ['paymentMethodData', 'pix', 'qrCodeImage'],
      ['paymentMethodData', 'pix', 'qr_code_image'],
      ['paymentMethodData', 'pix', 'image'],
      ['payment_method_data', 'pix', 'qrCodeImage'],
      ['payment_method_data', 'pix', 'qr_code_image'],
      ['payment_method_data', 'pix', 'image'],
      ['paymentMethod', 'pix', 'qrCodeImage'],
      ['paymentMethod', 'pix', 'qr_code_image'],
      ['paymentMethod', 'pix', 'image'],
      ['payment_method', 'pix', 'qrCodeImage'],
      ['payment_method', 'pix', 'qr_code_image'],
      ['payment_method', 'pix', 'image'],
      ['qr', 'image'],
      ['qr', 'qrCodeImage'],
      ['qr', 'qr_code_image'],
      ['pixData', 'image'],
      ['pixData', 'qrCodeImage'],
      ['pixData', 'qr_code_image'],
      ['pix_data', 'image'],
      ['pix_data', 'qrCodeImage'],
      ['pix_data', 'qr_code_image']
    ]) ||
    findNestedStringByKey(data, ['pixqrcodeimage', 'qrcodeimage', 'qrimage', 'image']) ||
    ''
  );
}

function readChargeReference(data) {
  return (
    readFirstString(data, ['id', 'transactionId', 'transaction_id', 'reference', 'referenceId', 'reference_id', 'externalId', 'external_id']) ||
    findNestedStringByKey(data, ['id', 'transactionid', 'reference', 'referenceid', 'externalid']) ||
    ''
  );
}

function readChargeStatus(data) {
  return (
    readFirstString(data, ['status', 'paymentStatus', 'payment_status']) ||
    findNestedStringByKey(data, ['status', 'paymentstatus']) ||
    ''
  );
}

function readChargeAmount(data) {
  return (
    readFirstNumber(data, ['amount', 'value', 'total', 'totalAmount', 'total_amount']) ||
    findNestedNumberByKey(data, ['amount', 'value', 'total', 'totalamount']) ||
    0
  );
}

function readChargeCreatedAt(data) {
  return (
    readFirstString(data, ['createdAt', 'created_at']) ||
    findNestedStringByKey(data, ['createdat']) ||
    null
  );
}

function readChargeExpiresAt(data) {
  return (
    readFirstString(data, ['expiresAt', 'expirationDate', 'expires_at', 'expiration_date']) ||
    findNestedStringByKey(data, ['expiresat', 'expirationdate']) ||
    null
  );
}

function readChargePaidAt(data) {
  return (
    readFirstString(data, ['paidAt', 'paid_at']) ||
    findNestedStringByKey(data, ['paidat']) ||
    null
  );
}

function readFirstString(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function readFirstNumber(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function readNestedString(data, paths) {
  for (const path of paths) {
    const value = path.reduce((current, key) => current?.[key], data);

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function normalizeImageSource(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.startsWith('data:image/')) {
    return normalized;
  }

  if (/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return `data:image/png;base64,${normalized}`;
  }

  return normalized;
}

function findNestedStringByKey(data, normalizedKeys) {
  return findNestedValueByKey(data, normalizedKeys, 'string') || '';
}

function findNestedNumberByKey(data, normalizedKeys) {
  return findNestedValueByKey(data, normalizedKeys, 'number') || 0;
}

function findNestedValueByKey(data, normalizedKeys, expectedType, seen = new WeakSet()) {
  if (!data || typeof data !== 'object') {
    return expectedType === 'number' ? 0 : '';
  }

  if (seen.has(data)) {
    return expectedType === 'number' ? 0 : '';
  }

  seen.add(data);

  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findNestedValueByKey(item, normalizedKeys, expectedType, seen);
      if (result) {
        return result;
      }
    }

    return expectedType === 'number' ? 0 : '';
  }

  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = normalizeKey(key);

    if (normalizedKeys.includes(normalizedKey)) {
      if (expectedType === 'string' && typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      if (expectedType === 'number') {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }

        if (typeof value === 'string' && value.trim()) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
      }
    }

    if (value && typeof value === 'object') {
      const result = findNestedValueByKey(value, normalizedKeys, expectedType, seen);
      if (result) {
        return result;
      }
    }
  }

  return expectedType === 'number' ? 0 : '';
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function generateQrDataUrl(value) {
  return QRCode.toDataURL(value, {
    margin: 1,
    width: 300,
    color: {
      dark: '#101010',
      light: '#f3efe8'
    }
  });
}

function formatCents(amountCents) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format((amountCents || 0) / 100);
}

function readPostbackUrl() {
  return readEnv('RETURN_URL', 'GATEWAY_POSTBACK_URL', 'PODPAY_POSTBACK_URL') || getWebhookUrl();
}

function getWebhookUrl() {
  if (!appUrl) {
    return '';
  }

  return `${appUrl.replace(/\/$/, '')}/return/notify`;
}

function readDefaultProfile() {
  return {
    name: readEnv('HOLDER_NAME', 'CHECKOUT_NAME'),
    email: readEnv('HOLDER_MAIL', 'CHECKOUT_EMAIL').trim().toLowerCase(),
    phone: onlyDigits(readEnv('HOLDER_PHONE', 'CHECKOUT_PHONE')),
    documentType: readEnv('HOLDER_DOC_KIND', 'CHECKOUT_DOCUMENT_TYPE').toLowerCase(),
    documentNumber: onlyDigits(readEnv('HOLDER_DOC_ID', 'CHECKOUT_DOCUMENT_NUMBER')),
    title: readEnv('ITEM_NAME', 'CHECKOUT_TITLE') || 'Pagamento'
  };
}

function getChargeProfileError(profile) {
  if (!profile.name || !profile.email || !profile.phone || !profile.documentType || !profile.documentNumber) {
    return 'Complete os dados ocultos da cobranca antes de liberar o acesso.';
  }

  if (!['cpf', 'cnpj'].includes(profile.documentType)) {
    return 'Defina HOLDER_DOC_KIND como cpf ou cnpj.';
  }

  if (profile.documentType === 'cpf' && profile.documentNumber.length !== 11) {
    return 'Defina um CPF valido em HOLDER_DOC_ID.';
  }

  if (profile.documentType === 'cnpj' && profile.documentNumber.length !== 14) {
    return 'Defina um CNPJ valido em HOLDER_DOC_ID.';
  }

  if (profile.phone.length < 10 || profile.phone.length > 13) {
    return 'Defina um telefone valido em HOLDER_PHONE.';
  }

  if (!z.string().email().safeParse(profile.email).success) {
    return 'Defina um e-mail valido em HOLDER_MAIL.';
  }

  return '';
}
