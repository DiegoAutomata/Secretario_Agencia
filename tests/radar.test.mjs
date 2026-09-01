import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../Code.gs', import.meta.url), 'utf8')

function loadFunction(name) {
  const sandbox = {
    console,
    Utilities: {
      formatDate(date) {
        return date.toISOString().slice(0, 16).replace('T', ' ')
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return vm.runInContext(name, sandbox)
}

test('un remitente Workana no verificado queda sospechoso y exige validacion local', () => {
  const classifyWorkanaEmail = loadFunction('classifyWorkanaEmail_')
  const result = classifyWorkanaEmail({
    id: 'gmail-123',
    from: 'Workana <proyectos@workana.com>',
    subject: 'Nuevo proyecto disponible para ti',
    excerpt: 'Mira este proyecto https://www.workana.com/job/agente-ia',
  })

  assert.equal(result.isWorkana, true)
  assert.equal(result.authenticity, 'suspicious')
  assert.equal(result.requiresLocalValidation, true)
  assert.deepEqual(Array.from(result.safeProjectUrls), ['https://www.workana.com/job/agente-ia'])
})

test('Workana Academy se clasifica como administrativo y nunca como oportunidad', () => {
  const classifyWorkanaEmail = loadFunction('classifyWorkanaEmail_')
  const result = classifyWorkanaEmail({
    id: 'gmail-124',
    from: 'Workana Academy <academy@workana.com>',
    subject: 'Curso semanal de Workana Academy',
    excerpt: 'Aprende nuevas habilidades',
  })

  assert.equal(result.eventType, 'administrative')
  assert.equal(result.shouldAlert, false)
  assert.equal(result.operatorMode, 'none')
})

test('solo conserva enlaces HTTPS del host Workana y elimina duplicados', () => {
  const extractSafeWorkanaUrls = loadFunction('extractSafeWorkanaUrls_')
  const urls = extractSafeWorkanaUrls([
    'Proyecto https://www.workana.com/job/agente-ia.',
    'Duplicado https://www.workana.com/job/agente-ia',
    'Inseguro http://workana.com/job/no',
    'Parecido https://workana.com.evil.example/job/no',
    'Credenciales https://diego:clave@workana.com/job/no',
  ].join(' '))

  assert.deepEqual(Array.from(urls), ['https://www.workana.com/job/agente-ia'])
})

test('construye una alerta de WhatsApp con analisis, borrador y limite de accion', () => {
  const buildWhatsAppMessage = loadFunction('buildWhatsAppMessage_')
  const message = buildWhatsAppMessage({
    from: 'Cliente <cliente@example.com>',
    subject: 'Entrevista para proyecto de automatizacion',
    date: new Date('2026-09-01T12:00:00Z'),
    permalink: 'https://mail.google.com/mail/u/0/#inbox/abc',
    classification: {
      category: 'client_lead',
      urgency: 'high',
      confidence: 92,
      reason: 'Solicita una entrevista concreta.',
      suggested_action: 'Responder hoy.',
      draft_reply: 'Hola, gracias por escribirme. Tengo disponibilidad mañana.',
    },
  })

  assert.match(message, /Radar de oportunidades/)
  assert.match(message, /Solicita una entrevista concreta\./)
  assert.match(message, /Borrador para revisar/)
  assert.match(message, /Tengo disponibilidad mañana\./)
  assert.match(message, /No se envio ninguna respuesta/)
})

test('construye el request privado al puente del radar', () => {
  const buildRadarBridgeRequest = loadFunction('buildRadarBridgeRequest_')
  const request = buildRadarBridgeRequest({
    url: 'https://www.lezrai.com/api/radar/bridge/',
    secret: 'radar-secret',
  }, { action: 'notify', message: 'Mensaje de prueba' })

  assert.equal(request.url, 'https://www.lezrai.com/api/radar/bridge')
  assert.equal(request.options.headers.Authorization, 'Bearer radar-secret')
  assert.deepEqual(JSON.parse(request.options.payload), {
    action: 'notify',
    message: 'Mensaje de prueba',
  })
})

test('la notificacion conserva el estado Workana para mostrar la validacion pendiente', () => {
  const createNotificationAlert = loadFunction('createNotificationAlert_')
  const workana = {
    isWorkana: true,
    eventType: 'new_project',
    authenticity: 'suspicious',
    requiresLocalValidation: true,
  }
  const alert = createNotificationAlert({
    id: 'gmail-125',
    from: 'Workana <projects@workana.com>',
    subject: 'Nuevo proyecto',
    date: new Date('2026-09-01T12:00:00Z'),
    permalink: 'https://mail.google.com/mail/u/0/#inbox/def',
  }, {
    category: 'workana_project',
    confidence: 85,
  }, { workana })

  assert.deepEqual(JSON.parse(JSON.stringify(alert.workana)), workana)
  assert.equal(alert.messageId, 'gmail-125')
})

test('Workana conserva proyectos con encaje de 6 a 10 y descarta 5 o menos', () => {
  const shouldNotify = loadFunction('shouldNotify_')
  const firstPass = {
    explicitMatches: [],
    workana: {
      isWorkana: true,
      eventType: 'new_project',
    },
  }

  assert.equal(shouldNotify({
    is_opportunity: true,
    fit_score: 6,
    confidence: 70,
  }, firstPass), true)
  assert.equal(shouldNotify({
    is_opportunity: true,
    fit_score: 5,
    confidence: 95,
  }, firstPass), false)
})

test('las tres cuentas procesan oportunidades generales y solo freelance procesa Workana', () => {
  const shouldProcessForMailbox = loadFunction('shouldProcessForMailbox_')

  assert.equal(shouldProcessForMailbox('diegofreelance21@gmail.com', true), true)
  assert.equal(shouldProcessForMailbox('diegolezana1@gmail.com', true), false)
  assert.equal(shouldProcessForMailbox('diegolezana7@gmail.com', true), false)
  assert.equal(shouldProcessForMailbox('diegolezana1@gmail.com', false), true)
  assert.equal(shouldProcessForMailbox('diegolezana7@gmail.com', false), true)
  assert.equal(shouldProcessForMailbox('diegofreelance21@gmail.com', false), true)
  assert.equal(shouldProcessForMailbox('otra@gmail.com', false), false)
})
