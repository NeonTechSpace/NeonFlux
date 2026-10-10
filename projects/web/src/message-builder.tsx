import { useId, useState } from 'react'
import type { PublishingContent, PublishingEmbed } from '@neonflux/contracts/publishing-base'
import { FormInputError } from './settings-form'
import { importMessage, validateMessage, validateResponseMessage } from './message-content'

export function MessageBuilder({ value,onChange,disabled = false,profile = 'publishing' }: { value: string, onChange: (value: string) => void, disabled?: boolean, profile?: 'publishing' | 'response' }) {
  const id = useId(), [json,setJson] = useState(''), [jsonOpen,setJsonOpen] = useState(false), [error,setError] = useState('')
  const message = JSON.parse(value) as PublishingContent, embed = message.embed
  const change = (next: PublishingContent) => { onChange(JSON.stringify(next)); setError('') }
  const patchEmbed = (patch: Partial<PublishingEmbed>) => change({ ...message, embed: { ...embed,...patch } })
  const remove = (key: keyof PublishingEmbed) => { const next = { ...embed }; delete next[key]; change({ ...message,embed: next }) }
  const input = (label: string,value: string,maxLength: number,onChange: (value: string) => void,multiline = false) => <label>{label}{multiline ? <textarea rows={3} maxLength={maxLength} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> : <input maxLength={maxLength} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />}</label>
  const defaults: Record<string,unknown> = { author: { name: '' },footer: { text: '' },thumbnail: { url: '' },image: { url: '' },fields: [] }
  return <div className="message-builder">
    {input('Message text',message.content,2000,content => change({ ...message,content }),true)}
    {profile === 'response' && <p className="field-help">Responses use message text or one embed with title, description and color. Leave message text empty when using an embed</p>}
    <div className="actions"><button type="button" className="secondary" disabled={disabled} onClick={() => { if (embed) { const next = { ...message }; delete next.embed; change(next) } else change({ ...message,embed: { color: 0x648ccc } }) }}>{embed ? 'Remove embed' : 'Add embed'}</button><button type="button" className="secondary" disabled={disabled} aria-expanded={jsonOpen} onClick={() => setJsonOpen(!jsonOpen)}>Import / export JSON</button></div>
    {embed && <fieldset className="builder-embed"><legend>Embed</legend>
      {input('Embed title',embed.title ?? '',256,title => patchEmbed({ title }))}
      {input('Embed description',embed.description ?? '',profile === 'response' ? 4000 : 4096,description => patchEmbed({ description }),true)}
      <div className="builder-columns">{profile === 'publishing' && input('Title URL',embed.url ?? '',2048,url => { if (url) patchEmbed({ url }); else remove('url') })}<label>Accent color<input type="color" value={`#${(embed.color ?? 0).toString(16).padStart(6,'0')}`} disabled={disabled} onChange={event => patchEmbed({ color: parseInt(event.target.value.slice(1),16) })} /></label></div>
      {profile === 'publishing' && input('Timestamp (ISO, optional)',embed.timestamp ?? '',128,timestamp => { if (timestamp) patchEmbed({ timestamp }); else remove('timestamp') })}
      {profile === 'publishing' && (['author','footer','thumbnail','image'] as const).map(key => {
        const section = embed[key]
        if (!section) return null
        const title = key === 'author' ? 'Author' : key === 'footer' ? 'Footer' : key === 'thumbnail' ? 'Thumbnail' : 'Image'
        return <fieldset key={key} className="builder-part"><legend>{title}</legend><button className="secondary remove-part" type="button" disabled={disabled} onClick={() => remove(key)}>Remove {title.toLowerCase()}</button>
          {key === 'author' && <>{input('Author name',embed.author?.name ?? '',256,name => patchEmbed({ author: { ...embed.author!,name } }))}{input('Author URL',embed.author?.url ?? '',2048,url => { const author = { ...embed.author! }; if (url) author.url = url; else delete author.url; patchEmbed({ author }) })}{input('Author icon URL',embed.author?.iconUrl ?? '',2048,iconUrl => { const author = { ...embed.author! }; if (iconUrl) author.iconUrl = iconUrl; else delete author.iconUrl; patchEmbed({ author }) })}</>}
          {key === 'footer' && <>{input('Footer text',embed.footer?.text ?? '',2048,text => patchEmbed({ footer: { ...embed.footer!,text } }))}{input('Footer icon URL',embed.footer?.iconUrl ?? '',2048,iconUrl => { const footer = { ...embed.footer! }; if (iconUrl) footer.iconUrl = iconUrl; else delete footer.iconUrl; patchEmbed({ footer }) })}</>}
          {(key === 'thumbnail' || key === 'image') && <>{input(`${title} URL`,embed[key]?.url ?? '',2048,url => patchEmbed({ [key]: { ...embed[key]!,url } }))}{input(`${title} description`,embed[key]?.description ?? '',4096,description => { const media = { ...embed[key]! }; if (description) media.description = description; else delete media.description; patchEmbed({ [key]: media }) })}</>}
        </fieldset>
      })}
      {profile === 'publishing' && (embed.fields ?? []).map((field,index) => <fieldset className="builder-part" key={index}><legend>Field {index + 1}</legend>{input(`Field ${index + 1} name`,field.name,256,name => patchEmbed({ fields: embed.fields!.map((row,i) => i === index ? { ...row,name } : row) }))}{input(`Field ${index + 1} value`,field.value,1024,value => patchEmbed({ fields: embed.fields!.map((row,i) => i === index ? { ...row,value } : row) }),true)}<label><input type="checkbox" disabled={disabled} checked={field.inline ?? false} onChange={event => patchEmbed({ fields: embed.fields!.map((row,i) => i === index ? { ...row,inline: event.target.checked } : row) })} />Inline field {index + 1}</label><button type="button" className="secondary" disabled={disabled} onClick={() => patchEmbed({ fields: embed.fields!.filter((_,i) => i !== index) })}>Remove field {index + 1}</button></fieldset>)}
      {profile === 'publishing' && <div className="actions">{(['author','footer','thumbnail','image'] as const).filter(key => !embed[key]).map(key => <button key={key} type="button" className="secondary" disabled={disabled} onClick={() => patchEmbed({ [key]: defaults[key] })}>Add {key}</button>)}<button type="button" className="secondary" disabled={disabled || (embed.fields?.length ?? 0) >= 25} onClick={() => patchEmbed({ fields: [...(embed.fields ?? []),{ name: '',value: '',inline: false }] })}>Add field</button></div>}
    </fieldset>}
    {jsonOpen && <div className="json-editor"><label htmlFor={`${id}-json`}>Message JSON</label><textarea id={`${id}-json`} rows={8} value={json} disabled={disabled} onChange={event => setJson(event.target.value)} placeholder={profile === 'response' ? '{"content":"Hello"}' : '{"content":"Hello","embed":{"title":"Welcome"}}'} /><div className="actions"><button type="button" className="secondary" disabled={disabled} onClick={() => { try { const next = importMessage(json); change(profile === 'response' ? validateResponseMessage(next,false) : next); setError('') } catch (error) { setError(error instanceof FormInputError ? error.message : 'Unable to import JSON') } }}>Import JSON</button><button type="button" className="secondary" disabled={disabled} onClick={() => setJson(JSON.stringify(message,null,2))}>Export JSON</button></div></div>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <MessagePreview message={message} profile={profile} />
  </div>
}

export function MessagePreview({ message,profile = 'publishing' }: { message: PublishingContent, profile?: 'publishing' | 'response' }) {
  const embed = message.embed
  let warning = ''
  try { if (profile === 'response') validateResponseMessage(message); else validateMessage(message,false) } catch (error) { warning = error instanceof Error ? error.message : 'Invalid message' }
  return <section className="message-preview" aria-label="Message preview"><h3>Live preview</h3><p className="field-help">Approximate layout. Provider formatting may differ</p>{message.content && <div className="preview-text">{message.content}</div>}{embed && <div className="preview-embed" style={{ borderLeftColor: `#${(embed.color ?? 0).toString(16).padStart(6,'0')}` }}>{embed.thumbnail?.url && <img className="preview-thumbnail" src={embed.thumbnail.url} alt={embed.thumbnail.description ?? 'Embed thumbnail'} />}{embed.author && <p className="preview-author">{embed.author.name}</p>}{embed.title && <h3>{embed.title}</h3>}{embed.description && <div className="preview-text">{embed.description}</div>}<div className="preview-fields">{embed.fields?.map((field,index) => <div className={field.inline ? 'preview-field inline' : 'preview-field'} key={index}><strong>{field.name || 'Field name'}</strong><div className="preview-text">{field.value}</div></div>)}</div>{embed.image?.url && <img className="preview-image" src={embed.image.url} alt={embed.image.description ?? 'Embed image'} />}{embed.footer && <p className="muted">{embed.footer.text}</p>}{embed.timestamp && <small className="muted">{embed.timestamp}</small>}</div>}{!message.content && !embed && <p className="muted">Add text or an embed to see your message</p>}{warning && <p className="error-text" role="status">{warning}</p>}</section>
}
