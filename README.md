# Gmail Opportunity Monitor

Monitor gratis 24/7 para detectar oportunidades comerciales en Gmail, validarlas con Groq y avisar por Telegram.

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
GROQ_API_KEY=tu_api_key_de_groq
GROQ_MODEL=llama-3.1-8b-instant
TELEGRAM_BOT_TOKEN=token_del_bot
TELEGRAM_CHAT_ID=tu_chat_id
ENABLE_TELEGRAM_ALERTS=false
```

`ENABLE_TELEGRAM_ALERTS=false` es intencional: deja el sistema en modo simulacion.

## Crear Telegram Bot

1. Abrir Telegram y hablar con `@BotFather`.
2. Crear un bot con `/newbot`.
3. Copiar el token en `TELEGRAM_BOT_TOKEN`.
4. Enviarle un mensaje cualquiera al bot.
5. Obtener tu `chat_id` con:

```text
https://api.telegram.org/botTU_TOKEN/getUpdates
```

Buscar `chat.id` en la respuesta y guardarlo como `TELEGRAM_CHAT_ID`.

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
5. Ejecutar `testTelegram`.
6. Si llega el mensaje de prueba y la simulacion se ve bien, ejecutar `enableTelegramAlerts`.
7. Ejecutar `installFiveMinuteTrigger`.

## Funcionamiento

- Cada corrida revisa correos recientes en Inbox, Updates, Spam y una busqueda general reciente.
- Primero descarta ruido evidente localmente.
- Tambien descarta confirmaciones automaticas de postulacion como "gracias por postularte", "application received" o "we will review your application".
- Las oportunidades laborales solo pasan si piden entrevista, disponibilidad, proximos pasos, mas informacion o una respuesta concreta.
- Solo los candidatos pasan a Groq.
- Groq devuelve JSON con decision, categoria, confianza, urgencia, motivo y accion sugerida.
- Telegram se envia solo si la confianza supera el umbral o si hay un pedido comercial explicito.
- Si Groq falla, los correos con senales fuertes igual generan alerta fallback.
- No responde, archiva, borra ni etiqueta correos.

## Seguridad y costos

- No hay claves hardcodeadas en el codigo.
- El sistema usa Google Apps Script, Telegram Bot API y Groq.
- Para reducir costos y cuidar privacidad, Groq recibe solo remitente, asunto, fecha, snippet y extracto corto.
- El monitor guarda IDs procesados en `PropertiesService` para evitar duplicados.

## Operacion

- Apagar alertas reales: ejecutar `disableTelegramAlerts`.
- Borrar estado de deduplicacion: ejecutar `clearMonitorState`.
- Eliminar el trigger: ejecutar `uninstallMonitor`.
- Volver a instalar el trigger: ejecutar `installFiveMinuteTrigger`.

## Fuentes tecnicas revisadas

- Groq Chat Completions API: https://console.groq.com/docs/api-reference
- Groq supported models: https://console.groq.com/docs/models
- Telegram `sendMessage`: https://core.telegram.org/bots/api#sendmessage
- Apps Script Gmail service: https://developers.google.com/apps-script/reference/gmail/gmail-app
- Apps Script PropertiesService: https://developers.google.com/apps-script/reference/properties/properties-service
