import type { PublishingContent, PublishingEmbed, ResponseReply } from '@neonflux/backend/contracts'
import { FormInputError } from './settings-form'

function fail(message: string): never { throw new FormInputError(message) }
function object(value: unknown, keys: string[], required: string[] = []): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Message JSON must use objects')
  const row = value as Record<string,unknown>
  if (Object.keys(row).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(row,key))) fail('Message JSON contains unsupported or missing properties')
  return row
}
const meaningful = (text: string) => text.replace(/[\u000c\u202e]/g,'').trim()
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || required && !meaningful(value)) fail(`Use text of up to ${max} characters${required ? ', with a nonempty value' : ''}`)
  return value
}
function url(value: unknown): string {
  const result = text(value,2048,true)
  try { const parsed = new URL(result); if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.href.length > 2048) fail('Use an HTTP or HTTPS URL without credentials') } catch { fail('Use an HTTP or HTTPS URL without credentials') }
  return result
}
export function validateMessage(value: unknown, deliverable = true): PublishingContent {
  const row = object(value,['content','embed'],['content'])
  const result: PublishingContent = { content: text(row.content,2000) }
  if (row.embed !== undefined) {
    const source = object(row.embed,['title','description','url','color','timestamp','author','footer','image','thumbnail','fields'])
    const embed: PublishingEmbed = {}
    if (source.title !== undefined) embed.title = text(source.title,256)
    if (source.description !== undefined) embed.description = text(source.description,4096,source.description !== '')
    if (source.url !== undefined) embed.url = url(source.url)
    if (source.color !== undefined) { if (!Number.isInteger(source.color) || Number(source.color) < 0 || Number(source.color) > 0xffffff) fail('Embed color must be an integer between 0 and 16777215'); embed.color = Number(source.color) }
    if (source.timestamp !== undefined) {
      const timestamp = text(source.timestamp,128)
      const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(timestamp)
      if (!match || !Number.isFinite(Date.parse(timestamp))) fail('Use an ISO timestamp with a timezone')
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      if (month < 1 || month > 12 || day < 1 || day > [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month - 1]!) fail('Use a valid calendar timestamp')
      embed.timestamp = timestamp
    }
    if (source.author !== undefined) { const author = object(source.author,['name','url','iconUrl'],['name']); embed.author = { name: text(author.name,256,true), ...(author.url !== undefined ? { url: url(author.url) } : {}), ...(author.iconUrl !== undefined ? { iconUrl: url(author.iconUrl) } : {}) } }
    if (source.footer !== undefined) { const footer = object(source.footer,['text','iconUrl'],['text']); embed.footer = { text: text(footer.text,2048,true), ...(footer.iconUrl !== undefined ? { iconUrl: url(footer.iconUrl) } : {}) } }
    for (const key of ['image','thumbnail'] as const) if (source[key] !== undefined) { const media = object(source[key],['url','description'],['url']); embed[key] = { url: url(media.url), ...(media.description !== undefined ? { description: text(media.description,4096,true) } : {}) } }
    if (source.fields !== undefined) {
      if (!Array.isArray(source.fields) || source.fields.length > 25) fail('An embed supports up to twenty-five fields')
      embed.fields = source.fields.map(value => { const field = object(value,['name','value','inline'],['name','value']); if (field.inline !== undefined && typeof field.inline !== 'boolean') fail('Field inline must be true or false'); return { name: text(field.name,256,true), value: text(field.value,1024), ...(field.inline !== undefined ? { inline: field.inline as boolean } : {}) } })
    }
    const total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.author?.name.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.image?.description?.length ?? 0) + (embed.thumbnail?.description?.length ?? 0) + (embed.fields ?? []).reduce((sum,field) => sum + field.name.length + field.value.length,0)
    if (total > 6000) fail('Embed text exceeds six thousand characters')
    result.embed = embed
  }
  const embed = result.embed
  if (deliverable && !meaningful(result.content) && !(embed && (meaningful(embed.title ?? '') || meaningful(embed.description ?? '') || embed.author || embed.footer || embed.image || embed.thumbnail || embed.fields?.length))) fail('Add message text or meaningful embed content')
  return result
}
export function importMessage(json: string): PublishingContent {
  let value: unknown
  try { value = JSON.parse(json) } catch { fail('Message JSON is invalid') }
  return validateMessage(value,false)
}
export function validateResponseMessage(value: unknown, deliverable = true): PublishingContent {
  const message = validateMessage(value,false)
  if (message.embed) {
    if (Object.keys(message.embed).some(key => !['title','description','color'].includes(key))) fail('Response embeds support title, description and color only')
    if (message.content) fail('Choose message text or an embed for this response. Clear the message text to use an embed')
    if ((message.embed.description?.length ?? 0) > 4000) fail('Response embed description supports up to 4000 characters')
    if (deliverable && !meaningful(message.embed.description ?? '')) fail('Add a response embed description')
  } else if (deliverable && !meaningful(message.content)) fail('Add response message text')
  return message
}
export function responseMessage(json: string): ResponseReply {
  const message = validateResponseMessage(importMessage(json))
  return message.embed ? { type: 'embed',embed: { title: message.embed.title ?? '',description: message.embed.description!,...(message.embed.color !== undefined ? { color: message.embed.color } : {}) } } : { type: 'text',text: message.content }
}
export function responseReplyMessage(reply: ResponseReply): PublishingContent {
  return reply.type === 'text' ? { content: reply.text } : { content: '',embed: { ...reply.embed } }
}
