# Secretario Agencia — Radar Gmail + Workana

Monitor cloud 24/7 para detectar oportunidades comerciales en Gmail, aplicar los filtros de Diego/Lezrai y Workana Operator, redactar un borrador para revisión y avisar a un grupo de WhatsApp mediante el puente privado de Lezrai.

Esta version esta ajustada para Diego Lezana y Lezrai: sistemas digitales para agencias que escalan, agentes de IA, automatizaciones, integraciones, plataformas premium, portales de cliente, onboarding automatizado, y oportunidades laborales/recruiting reales que requieran respuesta.

## Archivos

- `Code.gs`: codigo principal para Google Apps Script.
- `appsscript.json`: manifiesto con zona horaria, runtime y permisos.
- `DIEGO_PROFILE.md`: contexto local de Diego/Lezrai usado para orientar el filtro.

## Setup rapido

1. Crear un proyecto en Google Apps Script: https://script.google.com/
2. Pegar el contenido de `Code.gs` en el editor.
3. En `Project Settings`, activar `Show "appsscript.json" manifest file in editor`.
4. Reemplazar el manifiesto por el contenido de `appsscript.json`.
5. En `Project Settings` > `Script Properties`, crear estas propiedades:

```text
RADAR_BRIDGE_URL=https://www.lezrai.com/api/radar/bridge
RADAR_BRIDGE_SECRET=secreto_largo_del_radar
ENABLE_WHATSAPP_ALERTS=false
```

`ENABLE_WHATSAPP_ALERTS=false` es intencional: deja el sistema en simulacion hasta validar el grupo y aprobar el mensaje de prueba. Groq y GREEN-API permanecen en Vercel; sus claves no se copian a Apps Script. Las propiedades antiguas de Telegram siguen siendo compatibles como rollback, pero no son el canal recomendado.

## Obtener el identificador del grupo

El puente consulta la instancia GREEN-API ya autorizada con el WhatsApp personal y resuelve exactamente un grupo llamado `Lezrai | Radar de oportunidades`. Si no existe o hay dos grupos con ese nombre, rechaza el envío. No reutiliza el `chatId` de `Lezrai Leads` ni la instancia Evolution de TAOS.

## Primeras pruebas

1. Ejecutar `checkConfig` y revisar que las claves figuren como presentes.
2. Ejecutar `simulateLast7Days`.
3. Revisar `Executions` o `Logs` para ver:
   - correos escaneados;
   - descartados por reglas;
   - candidatos enviados a Groq;
   - oportunidades detectadas;
   - alertas fallback.
4. Ajustar palabras clave o umbral si hiciera falta.
5. Mostrar y aprobar el texto exacto de la prueba.
6. Ejecutar `testWhatsApp` y verificar el mensaje dentro del grupo, no sólo la respuesta HTTP.
7. Si la prueba y la simulacion se ven bien, ejecutar `enableWhatsAppAlerts`.
8. Ejecutar `installHourlyTrigger`.

El proyecto se ejecuta con dos cuentas y dos triggers instalables. `diegolezana1@gmail.com` procesa oportunidades generales y omite Workana. `diegofreelance21@gmail.com` procesa exclusivamente correos de Workana. Cada trigger usa el Gmail de la cuenta que lo crea; por eso ambas cuentas deben tener acceso al proyecto y autorizarlo por separado.

## Funcionamiento

- Cada corrida revisa correos recientes en Inbox, Updates, Spam y una busqueda general reciente.
- Primero descarta ruido evidente localmente.
- Tambien descarta confirmaciones automaticas de postulacion como "gracias por postularte", "application received" o "we will review your application".
- Las oportunidades laborales solo pasan si piden entrevista, disponibilidad, proximos pasos, mas informacion o una respuesta concreta.
- Solo los candidatos pasan a Groq.
- Los mensajes de Workana se separan en invitacion, respuesta, proyecto, digest o administrativo. Como no hay remitentes operativos verificados en la allowlist, todo remitente nuevo permanece `suspicious` hasta corroborarlo dentro de Workana.
- Un proyecto ordinario de Workana debe alcanzar encaje 6/10; se conservan los puntajes de 6 a 10. Invitaciones y respuestas directas pueden alertar aun con economia pendiente.
- Groq devuelve JSON con decision, categoria, confianza, urgencia, motivo y accion sugerida.
- El aviso de WhatsApp incluye analisis, accion sugerida y un borrador preliminar para revisar.
- El sistema nunca responde correos ni envia postulaciones. La validacion y cualquier envio en Workana requieren aprobacion exacta.
- Si Groq falla, los correos con senales fuertes igual generan alerta fallback.
- No responde, archiva, borra ni etiqueta correos.

## Seguridad y costos

- No hay claves hardcodeadas en el codigo.
- El sistema usa Google Apps Script y un puente privado en `lezrai.com`; GREEN-API y Groq sólo se invocan dentro de Vercel.
- Para reducir costos y cuidar privacidad, Groq recibe solo remitente, asunto, fecha, snippet y extracto corto.
- El monitor guarda IDs procesados en `PropertiesService` para evitar duplicados.

## Operacion

- Apagar alertas reales: ejecutar `disableWhatsAppAlerts`.
- Borrar estado de deduplicacion: ejecutar `clearMonitorState`.
- Eliminar el trigger: ejecutar `uninstallMonitor`.
- Volver a instalar el trigger: ejecutar `installHourlyTrigger`.

## Fuentes tecnicas revisadas

- Groq Chat Completions API: https://console.groq.com/docs/api-reference
- Groq supported models: https://console.groq.com/docs/models
- GREEN-API `sendMessage`: https://green-api.com/en/docs/api/sending/SendMessage/
- Apps Script Gmail service: https://developers.google.com/apps-script/reference/gmail/gmail-app
- Apps Script PropertiesService: https://developers.google.com/apps-script/reference/properties/properties-service
