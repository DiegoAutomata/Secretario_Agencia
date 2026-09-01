import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(
  await readFile(new URL('../appsscript.json', import.meta.url), 'utf8'),
)

test('autoriza leer el correo de la cuenta que ejecuta cada trigger', () => {
  assert.ok(
    manifest.oauthScopes.includes('https://www.googleapis.com/auth/userinfo.email'),
    'falta userinfo.email y Session.getEffectiveUser().getEmail() falla en produccion',
  )
})
