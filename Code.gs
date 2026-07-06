/**
 * Gmail Opportunity Monitor
 *
 * Google Apps Script 24/7 monitor for detecting commercial opportunities in Gmail.
 * It uses a cheap local filter first, then asks Groq only about promising messages,
 * and sends Telegram alerts only when a real opportunity is detected.
 */

const CONFIG = {
  SEARCH_WINDOW_DAYS: 2,
  SIMULATION_DAYS: 7,
  MAX_THREADS_PER_QUERY: 20,
  MAX_MESSAGES_PER_RUN: 40,
  MAX_GROQ_CALLS_PER_RUN: 12,
  EXCERPT_MAX_CHARS: 1800,
  CONFIDENCE_THRESHOLD: 70,
  STRONG_RULE_SCORE: 4,
  MAX_STORED_IDS: 700,
  ID_CHUNK_SIZE: 175,
  DEFAULT_GROQ_MODEL: 'llama-3.1-8b-instant',
  TIMEZONE: 'America/Argentina/Buenos_Aires'
};

const PROP = {
  GROQ_API_KEY: 'GROQ_API_KEY',
  GROQ_MODEL: 'GROQ_MODEL',
  TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  TELEGRAM_CHAT_ID: 'TELEGRAM_CHAT_ID',
  ENABLE_TELEGRAM_ALERTS: 'ENABLE_TELEGRAM_ALERTS',
  PROCESSED_IDS: 'PROCESSED_MESSAGE_IDS',
  NOTIFIED_IDS: 'NOTIFIED_MESSAGE_IDS',
  LAST_RUN_AT: 'LAST_RUN_AT'
};

const POSITIVE_PATTERNS = [
  'reunion', 'meeting', 'call', 'llamada', 'entrevista', 'agenda', 'agendar',
  'presupuesto', 'cotizacion', 'cotizar', 'quote', 'proposal', 'propuesta',
  'contratar', 'hire', 'hiring', 'trabajar contigo', 'work with you',
  'colaboracion', 'collaboration', 'partnership', 'partner',
  'proyecto', 'project', 'desarrollo', 'development', 'developer',
  'automatizacion', 'automation', 'inteligencia artificial', ' ia ', ' ai ',
  'agencia', 'agency', 'consultoria', 'consulting', 'cliente', 'client',
  'lead', 'oportunidad', 'opportunity', 'servicio', 'service',
  'implementacion', 'implementation', 'integracion', 'integration',
  'whatsapp', 'instagram', 'crm', 'stripe', 'mercado pago', 'paypal',
  'onboarding', 'bienvenida', 'portal de cliente', 'client portal',
  'dashboard', 'panel de control', 'google sheets', 'planillas',
  'sistema digital', 'digital system', 'agente de ia', 'ai agent',
  'chatbot', 'calificar clientes', 'qualify leads', 'agendar llamadas',
  'operacion', 'operation', 'procesos', 'processes', 'cuello de botella',
  'escalar agencia', 'scale agency'
];

const EXPLICIT_COMMERCIAL_PATTERNS = [
  'quiero una reunion', 'quisiera una reunion', 'agendar una reunion',
  'podemos reunirnos', 'coordinar una llamada', 'book a call', 'schedule a call',
  'request a quote', 'cotizacion', 'presupuesto', 'proposal', 'propuesta',
  'contratarte', 'contratar tus servicios', 'hire you', 'work with you',
  'necesito desarrollar', 'necesitamos desarrollar', 'tengo un proyecto',
  'we have a project', 'interested in your services',
  'quiero automatizar', 'queremos automatizar', 'necesito automatizar',
  'quiero un agente de ia', 'necesito un agente de ia',
  'quiero un chatbot', 'necesito un chatbot',
  'quiero escalar mi agencia', 'necesito escalar mi agencia',
  'quiero dejar de depender de planillas', 'quiero un portal de clientes',
  'necesito integrar whatsapp', 'necesito integrar stripe',
  'we need automation', 'we need an ai agent', 'we need a client portal'
];

const NEGATIVE_PATTERNS = [
  'unsubscribe', 'newsletter', 'boletin', 'promocion', 'promotion',
  'discount', 'descuento', 'oferta limitada', 'sale', 'black friday',
  'receipt', 'recibo', 'factura automatica', 'invoice', 'payment received',
  'verification code', 'codigo de verificacion', 'security alert',
  'password reset', 'restablecer contrasena', 'no-reply', 'noreply',
  'do not reply', 'notification', 'notificacion automatica',
  'digest', 'resumen semanal', 'social', 'new login', 'alerta de inicio'
];

const JOB_APPLICATION_ACK_PATTERNS = [
  'gracias por postularte', 'gracias por tu postulacion',
  'hemos recibido tu postulacion', 'recibimos tu postulacion',
  'tu postulacion ha sido recibida', 'postulacion recibida',
  'application received', 'we received your application',
  'thank you for applying', 'thanks for applying',
  'your application has been received', 'we have received your application',
  'hemos recibido tu cv', 'recibimos tu cv', 'received your resume',
  'received your cv', 'your resume has been received',
  'we will review your application', 'revisaremos tu postulacion',
  'nuestro equipo revisara tu perfil', 'we will be in touch if',
  'nos pondremos en contacto si', 'no reply is required',
  'no es necesario que respondas'
];

const REAL_JOB_OPPORTUNITY_PATTERNS = [
  'queremos coordinar una entrevista', 'queremos agendar una entrevista',
  'nos gustaria entrevistarte', 'nos gustaria coordinar una llamada',
  'queremos coordinar una llamada', 'podemos coordinar una entrevista',
  'disponibilidad para una entrevista', 'disponibilidad para una llamada',
  'schedule an interview', 'book an interview', 'invite you to interview',
  'would like to interview you', 'available for a call',
  'availability for an interview', 'next step is an interview',
  'technical interview', 'recruiter screen', 'hiring manager',
  'queremos avanzar', 'next steps', 'move forward with your application'
];

/**
 * Run this once after adding script properties. It installs the 5-minute trigger.
 */
function installFiveMinuteTrigger() {
  deleteMonitorTriggers_();
  ScriptApp.newTrigger('runMonitor')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Installed 5-minute trigger for runMonitor.');
}

/**
 * Main scheduled entrypoint. By default it runs in safe simulation mode until
 * ENABLE_TELEGRAM_ALERTS is set to true in Script Properties.
 */
function runMonitor() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Another run is still active. Skipping this run.');
    return;
  }

  try {
    const alertsEnabled = getRequiredProperty_(PROP.ENABLE_TELEGRAM_ALERTS) === 'true';
    const result = scanMailbox_({
      dryRun: !alertsEnabled,
      daysBack: CONFIG.SEARCH_WINDOW_DAYS
    });

    PropertiesService.getScriptProperties().setProperty(PROP.LAST_RUN_AT, new Date().toISOString());
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Safe review over the last 7 days. It never sends Telegram and never marks
 * messages as processed.
 */
function simulateLast7Days() {
  const result = scanMailbox_({
    dryRun: true,
    daysBack: CONFIG.SIMULATION_DAYS
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Use this after configuring Telegram to verify that the bot can reach you.
 */
function testTelegram() {
  sendTelegramAlert_({
    dryRun: false,
    messageId: 'manual-test',
    from: 'Gmail Opportunity Monitor',
    subject: 'Telegram test',
    date: new Date(),
    permalink: '',
    classification: {
      category: 'test',
      urgency: 'low',
      reason: 'Telegram is configured correctly.',
      suggested_action: 'No action needed.',
      confidence: 100
    }
  });
}

/**
 * Turns real alerts on. Run this only after simulation looks good.
 */
function enableTelegramAlerts() {
  PropertiesService.getScriptProperties().setProperty(PROP.ENABLE_TELEGRAM_ALERTS, 'true');
  Logger.log('Telegram alerts enabled.');
}

/**
 * Turns real alerts off. The monitor will keep running in simulation mode.
 */
function disableTelegramAlerts() {
  PropertiesService.getScriptProperties().setProperty(PROP.ENABLE_TELEGRAM_ALERTS, 'false');
  Logger.log('Telegram alerts disabled. Monitor is in simulation mode.');
}

/**
 * Removes all runMonitor triggers.
 */
function uninstallMonitor() {
  deleteMonitorTriggers_();
  Logger.log('Removed runMonitor triggers.');
}

/**
 * Clears local dedupe state. It does not change any Gmail messages.
 */
function clearMonitorState() {
  deleteChunkedIds_(PROP.PROCESSED_IDS);
  deleteChunkedIds_(PROP.NOTIFIED_IDS);
  PropertiesService.getScriptProperties().deleteProperty(PROP.LAST_RUN_AT);
  Logger.log('Monitor state cleared.');
}

/**
 * Shows whether required properties are present without printing secret values.
 */
function checkConfig() {
  const props = PropertiesService.getScriptProperties();
  const status = {
    groqApiKey: Boolean(props.getProperty(PROP.GROQ_API_KEY)),
    groqModel: props.getProperty(PROP.GROQ_MODEL) || CONFIG.DEFAULT_GROQ_MODEL,
    telegramBotToken: Boolean(props.getProperty(PROP.TELEGRAM_BOT_TOKEN)),
    telegramChatId: Boolean(props.getProperty(PROP.TELEGRAM_CHAT_ID)),
    alertsEnabled: props.getProperty(PROP.ENABLE_TELEGRAM_ALERTS) === 'true',
    lastRunAt: props.getProperty(PROP.LAST_RUN_AT) || null
  };
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

function scanMailbox_(options) {
  const dryRun = Boolean(options.dryRun);
  const daysBack = options.daysBack || CONFIG.SEARCH_WINDOW_DAYS;
  const processedIds = loadChunkedIds_(PROP.PROCESSED_IDS);
  const notifiedIds = loadChunkedIds_(PROP.NOTIFIED_IDS);
  const messages = collectRecentMessages_(daysBack);
  const summary = {
    dryRun: dryRun,
    daysBack: daysBack,
    scannedMessages: messages.length,
    skippedAlreadyProcessed: 0,
    rejectedByRules: 0,
    groqCandidates: 0,
    groqCalls: 0,
    opportunities: [],
    fallbackAlerts: [],
    pendingRetries: [],
    errors: []
  };

  let groqCalls = 0;

  for (let i = 0; i < messages.length; i++) {
    if (i >= CONFIG.MAX_MESSAGES_PER_RUN) break;

    const email = messages[i];
    if (processedIds[email.id]) {
      summary.skippedAlreadyProcessed++;
      continue;
    }

    const firstPass = classifyByRules_(email);
    if (!firstPass.isCandidate) {
      summary.rejectedByRules++;
      if (!dryRun) processedIds[email.id] = true;
      continue;
    }

    summary.groqCandidates++;
    let classification = null;

    if (groqCalls < CONFIG.MAX_GROQ_CALLS_PER_RUN && hasGroqKey_()) {
      try {
        classification = classifyWithGroq_(email, firstPass);
        groqCalls++;
        summary.groqCalls = groqCalls;
      } catch (err) {
        summary.errors.push({
          messageId: email.id,
          stage: 'groq',
          error: String(err && err.message ? err.message : err)
        });
      }
    }

    if (classification && shouldNotify_(classification, firstPass)) {
      const alert = buildAlertRecord_(email, classification, firstPass, 'groq');
      summary.opportunities.push(alert);

      if (!dryRun && !notifiedIds[email.id]) {
        sendTelegramAlert_({
          dryRun: false,
          messageId: email.id,
          from: email.from,
          subject: email.subject,
          date: email.date,
          permalink: email.permalink,
          classification: classification
        });
        notifiedIds[email.id] = true;
        processedIds[email.id] = true;
      }
      continue;
    }

    if (classification) {
      if (!dryRun) processedIds[email.id] = true;
      continue;
    }

    if (firstPass.isStrong) {
      const fallbackClassification = {
        is_opportunity: true,
        confidence: 65,
        category: 'rule_fallback',
        urgency: 'medium',
        reason: 'Strong local commercial signals were found, but Groq was unavailable or skipped.',
        suggested_action: 'Review this email manually.'
      };
      const alert = buildAlertRecord_(email, fallbackClassification, firstPass, 'fallback');
      summary.fallbackAlerts.push(alert);

      if (!dryRun && !notifiedIds[email.id]) {
        sendTelegramAlert_({
          dryRun: false,
          messageId: email.id,
          from: email.from,
          subject: email.subject,
          date: email.date,
          permalink: email.permalink,
          classification: fallbackClassification
        });
        notifiedIds[email.id] = true;
        processedIds[email.id] = true;
      }
    } else {
      summary.pendingRetries.push({
        messageId: email.id,
        from: email.from,
        subject: email.subject,
        reason: 'Candidate needs Groq confirmation and will be retried.'
      });
    }
  }

  if (!dryRun) {
    saveChunkedIds_(PROP.PROCESSED_IDS, processedIds);
    saveChunkedIds_(PROP.NOTIFIED_IDS, notifiedIds);
  }

  return summary;
}

function collectRecentMessages_(daysBack) {
  const queries = [
    'newer_than:' + daysBack + 'd in:inbox',
    'newer_than:' + daysBack + 'd category:updates',
    'newer_than:' + daysBack + 'd in:spam',
    'newer_than:' + daysBack + 'd -in:sent -in:drafts -in:trash'
  ];
  const byId = {};

  queries.forEach(function(query) {
    const threads = GmailApp.search(query, 0, CONFIG.MAX_THREADS_PER_QUERY);
    threads.forEach(function(thread) {
      const permalink = safeCall_(function() { return thread.getPermalink(); }, '');
      thread.getMessages().forEach(function(message) {
        const id = message.getId();
        if (byId[id]) return;

        const body = cleanText_(safeCall_(function() { return message.getPlainBody(); }, ''));
        const excerpt = trimText_(body, CONFIG.EXCERPT_MAX_CHARS);

        byId[id] = {
          id: id,
          threadId: safeCall_(function() { return thread.getId(); }, ''),
          from: message.getFrom(),
          subject: message.getSubject() || '(sin asunto)',
          date: message.getDate(),
          isUnread: safeCall_(function() { return message.isUnread(); }, false),
          excerpt: excerpt,
          snippet: trimText_(excerpt, 350),
          permalink: permalink
        };
      });
    });
  });

  return Object.keys(byId)
    .map(function(id) { return byId[id]; })
    .sort(function(a, b) { return b.date.getTime() - a.date.getTime(); });
}

function classifyByRules_(email) {
  const subjectText = normalize_(email.subject);
  const bodyText = normalize_([email.subject, email.from, email.snippet, email.excerpt].join(' '));
  const fromText = normalize_(email.from);

  const positiveMatches = uniqueMatches_(bodyText, POSITIVE_PATTERNS);
  const subjectMatches = uniqueMatches_(subjectText, POSITIVE_PATTERNS);
  const explicitMatches = uniqueMatches_(bodyText, EXPLICIT_COMMERCIAL_PATTERNS);
  const jobAckMatches = uniqueMatches_(bodyText, JOB_APPLICATION_ACK_PATTERNS);
  const realJobMatches = uniqueMatches_(bodyText, REAL_JOB_OPPORTUNITY_PATTERNS);
  const negativeMatches = uniqueMatches_(bodyText + ' ' + fromText, NEGATIVE_PATTERNS);

  const noReplySender = /(^|[<\s])(?:no-?reply|noreply|donotreply)@/i.test(email.from);
  const automatedJobApplicationAck = jobAckMatches.length > 0 && realJobMatches.length === 0;
  const positiveScore = positiveMatches.length + subjectMatches.length + explicitMatches.length * 2 + realJobMatches.length * 2;
  const negativeScore = negativeMatches.length + jobAckMatches.length * 2 + (noReplySender ? 2 : 0);
  const score = positiveScore - negativeScore;
  const hasExplicitIntent = explicitMatches.length > 0 || realJobMatches.length > 0;
  const looksLikeAutomatedNoise = negativeScore >= 2 && !hasExplicitIntent && subjectMatches.length === 0;

  return {
    isCandidate: !automatedJobApplicationAck && !looksLikeAutomatedNoise && (score >= 2 || hasExplicitIntent),
    isStrong: !automatedJobApplicationAck && !looksLikeAutomatedNoise && (score >= CONFIG.STRONG_RULE_SCORE || (hasExplicitIntent && positiveScore >= 3)),
    score: score,
    positiveMatches: positiveMatches,
    negativeMatches: negativeMatches,
    explicitMatches: explicitMatches.concat(realJobMatches),
    jobApplicationAckMatches: jobAckMatches
  };
}

function classifyWithGroq_(email, firstPass) {
  const apiKey = getRequiredProperty_(PROP.GROQ_API_KEY);
  const model = getRequiredProperty_(PROP.GROQ_MODEL) || CONFIG.DEFAULT_GROQ_MODEL;
  const payload = {
    model: model,
    temperature: 0,
    max_completion_tokens: 350,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You classify Gmail messages for Diego Lezana, founder of Lezrai and AI automation/software builder based in Argentina.',
          'His LinkedIn positioning is: he helps digital agencies and online businesses scale without losing clients or increasing operating costs, using AI agents, converting websites, and automation.',
          'Lezrai offers AI conversion agents, automated processes and integrations, premium web platforms, client portals, onboarding systems, dashboards, WhatsApp/Instagram/web assistants, Stripe/Mercado Pago/PayPal integrations, and systems that replace manual spreadsheets.',
          'The ideal lead is an agency owner, business owner, operator, founder, or team asking for help automating operations, qualifying leads, booking calls, integrating tools, building a client portal, creating an AI assistant, or improving response time and onboarding.',
          'Diego is also pursuing employment and contracting opportunities through LinkedIn. Real recruiter/company messages matter only when they request an interview, ask for availability, propose next steps, ask for more information, mention a concrete role/project, or require a reply.',
          'Detect messages that could create revenue: client leads, paid collaborations, meeting requests, project requests, consulting, contractor/freelance opportunities, hiring/recruiting messages that require action, or concrete business opportunities aligned with Diego and Lezrai.',
          'Reject generic job application acknowledgements such as thanks for applying, application received, we will review your profile, or no reply required.',
          'Reject newsletters, promotions, automated alerts, spam, vendors trying to sell generic tools, receipts, login alerts, and mass marketing.',
          'Return only valid JSON with these fields:',
          'is_opportunity boolean, confidence number 0-100, category string, urgency high|medium|low, reason string, suggested_action string.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          from: email.from,
          subject: email.subject,
          date: Utilities.formatDate(email.date, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
          snippet: email.snippet,
          excerpt: email.excerpt,
          local_rule_score: firstPass.score,
          local_positive_matches: firstPass.positiveMatches,
          local_explicit_matches: firstPass.explicitMatches,
          local_job_application_ack_matches: firstPass.jobApplicationAckMatches,
          local_negative_matches: firstPass.negativeMatches
        })
      }
    ]
  };

  const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Groq HTTP ' + status + ': ' + trimText_(text, 500));
  }

  const data = JSON.parse(text);
  const content = data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  if (!content) {
    throw new Error('Groq returned no message content.');
  }

  const parsed = parseJsonObject_(content);
  return normalizeClassification_(parsed);
}

function shouldNotify_(classification, firstPass) {
  if (!classification || !classification.is_opportunity) return false;
  if (classification.confidence >= CONFIG.CONFIDENCE_THRESHOLD) return true;
  if (firstPass.explicitMatches.length > 0 && classification.confidence >= 55) return true;
  return false;
}

function buildAlertRecord_(email, classification, firstPass, source) {
  return {
    source: source,
    messageId: email.id,
    from: email.from,
    subject: email.subject,
    date: Utilities.formatDate(email.date, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    category: classification.category,
    urgency: classification.urgency,
    confidence: classification.confidence,
    reason: classification.reason,
    suggestedAction: classification.suggested_action,
    localScore: firstPass.score,
    permalink: email.permalink
  };
}

function sendTelegramAlert_(alert) {
  const token = getRequiredProperty_(PROP.TELEGRAM_BOT_TOKEN);
  const chatId = getRequiredProperty_(PROP.TELEGRAM_CHAT_ID);
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const c = alert.classification;
  const dateText = Utilities.formatDate(alert.date, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
  const linkLine = alert.permalink
    ? '\n<a href="' + escapeHtml_(alert.permalink) + '">Abrir correo en Gmail</a>'
    : '';

  const message = [
    '<b>Nueva oportunidad por email</b>',
    '',
    '<b>De:</b> ' + escapeHtml_(alert.from),
    '<b>Asunto:</b> ' + escapeHtml_(alert.subject),
    '<b>Fecha:</b> ' + escapeHtml_(dateText),
    '<b>Categoria:</b> ' + escapeHtml_(c.category || 'sin categoria'),
    '<b>Urgencia:</b> ' + escapeHtml_(c.urgency || 'medium'),
    '<b>Confianza:</b> ' + escapeHtml_(String(c.confidence || 0)) + '%',
    '',
    '<b>Motivo:</b> ' + escapeHtml_(c.reason || 'Sin motivo informado.'),
    '<b>Accion sugerida:</b> ' + escapeHtml_(c.suggested_action || 'Revisar correo.') + linkLine
  ].join('\n');

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: trimText_(message, 3900),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Telegram HTTP ' + status + ': ' + trimText_(response.getContentText(), 500));
  }
}

function deleteMonitorTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runMonitor') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function hasGroqKey_() {
  return Boolean(PropertiesService.getScriptProperties().getProperty(PROP.GROQ_API_KEY));
}

function getRequiredProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function loadChunkedIds_(baseKey) {
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty(baseKey + '_CHUNK_COUNT') || '0');
  const ids = {};

  for (let i = 0; i < count; i++) {
    const raw = props.getProperty(baseKey + '_' + i) || '';
    raw.split('\n').forEach(function(id) {
      if (id) ids[id] = true;
    });
  }

  return ids;
}

function saveChunkedIds_(baseKey, idMap) {
  const ids = Object.keys(idMap).slice(-CONFIG.MAX_STORED_IDS);
  const props = PropertiesService.getScriptProperties();
  const oldCount = Number(props.getProperty(baseKey + '_CHUNK_COUNT') || '0');
  const chunks = [];

  for (let i = 0; i < ids.length; i += CONFIG.ID_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CONFIG.ID_CHUNK_SIZE).join('\n'));
  }

  chunks.forEach(function(chunk, index) {
    props.setProperty(baseKey + '_' + index, chunk);
  });
  for (let i = chunks.length; i < oldCount; i++) {
    props.deleteProperty(baseKey + '_' + i);
  }
  props.setProperty(baseKey + '_CHUNK_COUNT', String(chunks.length));
}

function deleteChunkedIds_(baseKey) {
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty(baseKey + '_CHUNK_COUNT') || '0');
  for (let i = 0; i < count; i++) {
    props.deleteProperty(baseKey + '_' + i);
  }
  props.deleteProperty(baseKey + '_CHUNK_COUNT');
}

function normalizeClassification_(raw) {
  return {
    is_opportunity: Boolean(raw.is_opportunity),
    confidence: clamp_(Number(raw.confidence || 0), 0, 100),
    category: String(raw.category || 'other'),
    urgency: normalizeUrgency_(raw.urgency),
    reason: String(raw.reason || ''),
    suggested_action: String(raw.suggested_action || '')
  };
}

function normalizeUrgency_(value) {
  const urgency = String(value || '').toLowerCase();
  if (urgency === 'high' || urgency === 'medium' || urgency === 'low') return urgency;
  return 'medium';
}

function parseJsonObject_(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw err;
  }
}

function uniqueMatches_(text, patterns) {
  const matches = {};
  patterns.forEach(function(pattern) {
    if (text.indexOf(normalize_(pattern)) !== -1) matches[pattern] = true;
  });
  return Object.keys(matches);
}

function normalize_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cleanText_(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function trimText_(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp_(value, min, max) {
  if (isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function safeCall_(fn, fallback) {
  try {
    return fn();
  } catch (err) {
    return fallback;
  }
}
