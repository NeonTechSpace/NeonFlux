import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localTime } from '../src/time.ts'

// Some ICU versions put a narrow no-break space before AM or PM, so spaces compare as one kind
const spaced = (text: string) => text.replace(/\s/g,' ')

test('A moment shows as a date and time in the viewer\'s own time zone and locale', () => {
  // Node follows TZ when it changes and runs each test file in its own process, so the zones set here stay in this file
  const at = Date.UTC(2026,9,10,10,21)
  process.env.TZ = 'UTC'
  assert.equal(spaced(localTime(at,'en-US')),'Oct 10, 2026, 10:21 AM')
  process.env.TZ = 'Asia/Kolkata'
  assert.equal(spaced(localTime(at,'en-US')),'Oct 10, 2026, 3:51 PM')
  assert.equal(spaced(localTime(new Date(at).toISOString(),'en-US')),'Oct 10, 2026, 3:51 PM')
  // Without a locale it follows the viewer's own
  assert.equal(localTime(at),new Intl.DateTimeFormat(undefined,{ dateStyle: 'medium',timeStyle: 'short' }).format(at))
})
