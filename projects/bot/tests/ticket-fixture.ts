import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { TicketStoreError, type TicketStore } from "../src/ticket-store.ts"

export function ticketBoundary(overrides: Partial<TicketStore> = {}) {
    const calls: { method: string, input: unknown }[] = [], categories = new Map<string,C.TicketCategory>(), intakes = new Map<number,C.TicketIntake>(), tickets = new Map<number,C.TicketRecord>()
    const entries: C.TicketEntry[] = [], transcripts = new Map<number,{ record: C.TicketTranscript, messages: C.TicketTranscriptMessage[], body: string }>()
    const settings: C.TicketSettings = { enabled: true, retentionDays: 30 }, claims = new Map<string,string>()
    const attempts = new Map<number,C.TicketAttempt>()
    const originalSend = new Map<number,C.TicketChannelSnapshot>()
    let serial = 0
    const cloned = <A>(value: A) => structuredClone(value)
    const fail = (method: string, status = 404) => Effect.fail(new TicketStoreError({ operation: method, status }))
    function grant(ticket: C.TicketRecord, source: C.TicketSource, action: C.TicketAction): C.TicketActionGrant {
        const base: C.TicketActionGrant = { attemptId: `synthetic_attempt_${++serial}`, attemptNo: serial, ticketNo: ticket.ticketNo, generation: ticket.generation,
            sourceId: source.messageId, actorId: source.context.actor.userId, botId: ticket.botId, requesterId: ticket.requesterId, requesterJoinedAt: ticket.requesterJoinedAt,
            visibility: ticket.visibility, supportRoleIds: ticket.supportRoleIds, action, dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 }
        if (ticket.channel) { base.channelId = ticket.channel.channelId; base.expectedChannel = cloned(ticket.channel) }
        if (action === "create") {
            const category = categories.get(ticket.categoryName)!
            const access = Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory
            base.channelName = `ticket-${ticket.ticketNo}`; base.parentId = category.parentId
            const overwrites: C.TicketOverwrite[] = [
                { id: source.serverId, type: "role", allow: ticket.visibility === "public" ? access.toString() : "0", deny: ticket.visibility === "private" ? Permissions.ViewChannel.toString() : "0" },
                { id: ticket.botId, type: "member", allow: (access | Permissions.ManageChannels | Permissions.ManageRoles).toString(), deny: "0" },
                { id: ticket.requesterId, type: "member", allow: access.toString(), deny: "0" },
                ...ticket.supportRoleIds.map(id => ({ id, type: "role" as const, allow: access.toString(), deny: "0" })),
            ]
            base.overwrites = overwrites.sort((a,b) => a.type < b.type ? -1 : a.type > b.type ? 1 : BigInt(a.id) < BigInt(b.id) ? -1 : 1)
        } else if (action === "introduction") base.content = { content: `Ticket ${ticket.ticketNo}. ${ticket.visibility} conversation. Intake stays private` }
        else if (action.startsWith("close") || action.startsWith("reopen")) {
            const id = action.endsWith("everyone") ? source.serverId : ticket.requesterId
            if (action === "close-everyone") originalSend.set(ticket.ticketNo, cloned(ticket.channel!))
            const original = (action.startsWith("reopen") ? originalSend.get(ticket.ticketNo)! : ticket.channel!).overwrites.find(o => o.id === id)!
            const closed = action.startsWith("close")
            const value = { ...original, allow: (closed ? BigInt(original.allow) & ~Permissions.SendMessages : BigInt(original.allow)).toString(),
                deny: (closed ? BigInt(original.deny) | Permissions.SendMessages : BigInt(original.deny)).toString() }
            base.targetOverwrite = value; base.desiredChannel = { ...cloned(ticket.channel!), overwrites: ticket.channel!.overwrites.map(o => o.id === id ? value : cloned(o)) }
        }
        ticket.currentAttempt = { ...base, outcome: "pending", createdAt: 0 }
        attempts.set(ticket.currentAttempt.attemptNo, ticket.currentAttempt)
        return cloned(base)
    }
    const store: TicketStore = {
        query(input) {
            calls.push({ method: "query", input }); const op = input.operation
            if (["private-intake","entries","attempt","transcripts","transcript","intake","intakes","category-config","tickets"].includes(op.type) && !input.context.actor.privateChannelVerified) return fail("query",403)
            if (op.type === "settings") return Effect.succeed({ type: "settings", settings: cloned(settings) })
            if (op.type === "categories") return Effect.succeed({ type: "categories", categories: [...categories.values()].map(c => ({ name:c.name,revision:c.revision,enabled:c.enabled,visibility:c.visibility,description:c.description })) })
            if (op.type === "category" || op.type === "category-config") { const c = categories.get(op.name); if (!c) return fail("query"); return op.type === "category-config" ? Effect.succeed({ type:"category-config",category:cloned(c) }) : Effect.succeed({ type:"category",category:{name:c.name,revision:c.revision,enabled:c.enabled,visibility:c.visibility,description:c.description} }) }
            if (op.type === "intake") { const intake = intakes.get(op.intakeNo); return intake ? Effect.succeed({type:"intake",intake:cloned(intake)}) : fail("query") }
            if (op.type === "intakes") return Effect.succeed({type:"intakes",intakes:[...intakes.values()].map(cloned)})
            if (op.type === "tickets") return Effect.succeed({type:"tickets",tickets:[...tickets.values()].map(cloned)})
            const ticket = tickets.get(op.ticketNo); if (!ticket) return fail("query")
            if (op.type === "ticket" || op.type === "locate") return Effect.succeed({type:op.type,ticket:cloned(ticket)})
            if (op.type === "private-intake") { const intake = [...intakes.values()].find(i => i.ticketNo === ticket.ticketNo)!; return Effect.succeed({type:"private-intake",ticketNo:ticket.ticketNo,questions:intake.category.questions,answers:intake.answers,erased:ticket.erased}) }
            if (op.type === "entries") return Effect.succeed({type:"entries",entries:entries.filter(e => e.ticketNo === ticket.ticketNo && e.kind === op.kind).map(cloned)})
            if (op.type === "attempt") { const attempt = attempts.get(op.attemptNo); return attempt?.ticketNo === op.ticketNo ? Effect.succeed({type:"attempt",attempt:cloned(attempt)}) : fail("query") }
            if (op.type === "transcripts") return Effect.succeed({type:"transcripts",transcripts:[...transcripts.values()].map(v => cloned(v.record))})
            if (op.type === "transcript") {
                const t = transcripts.get(op.transcriptNo), page = op.page ?? 1
                return t ? Effect.succeed({ type: "transcript", transcript: cloned(t.record), page, text: t.body.slice((page - 1) * 1500, page * 1500) }) : fail("query")
            }
            return fail("query")
        },
        manage(input) {
            calls.push({method:"manage",input}); const op=input.operation
            if (op.type === "settings") { if(op.enabled!==undefined)settings.enabled=op.enabled;if(op.retentionDays!==undefined)settings.retentionDays=op.retentionDays;return Effect.succeed({duplicate:false,type:"settings",settings:cloned(settings)}) }
            if (op.type === "category-create") { const category:C.TicketCategory={name:op.name,revision:1,enabled:true,visibility:op.visibility,description:op.description??"",parentId:op.parentId??null,supportRoleIds:op.supportRoleIds,questions:[],cannedReplies:[]};categories.set(category.name,category);return Effect.succeed({duplicate:false,type:"category",category:cloned(category)}) }
            if (["category-update","category-delete","canned-set","canned-remove"].includes(op.type)) {
                if (!("name" in op))return fail("manage");const c=categories.get(op.name);if(!c)return fail("manage")
                if(op.type==="category-delete"){categories.delete(op.name);return Effect.succeed({duplicate:false,type:"deleted",name:op.name})}
                if(op.type==="category-update")Object.assign(c,op.patch)
                if(op.type==="canned-set")c.cannedReplies.push({name:op.cannedName,templateName:op.templateName,templateRevision:op.expectedTemplateRevision,content:{content:"Canned reply"}})
                if(op.type==="canned-remove")c.cannedReplies=c.cannedReplies.filter(r=>r.name!==op.cannedName)
                c.revision++;return Effect.succeed({duplicate:false,type:"category",category:cloned(c)})
            }
            if (!("ticketNo" in op))return fail("manage");const ticket=tickets.get(op.ticketNo);if(!ticket)return fail("manage")
            if(op.type==="claim")ticket.claimedBy=input.context.actor.userId
            if(op.type==="unclaim")delete ticket.claimedBy
            if(op.type==="priority")ticket.priority=op.priority
            if(op.type==="erase")ticket.erased=true
            if(op.type==="note"){const entry:C.TicketEntry={entryNo:entries.length+1,ticketNo:ticket.ticketNo,authorId:input.context.actor.userId,kind:"note",createdAt:input.createdAt,content:{content:op.content},erased:false};entries.push(entry);return Effect.succeed({duplicate:false,type:"entry",entry})}
            if(op.type==="close"||op.type==="reopen"||op.type==="delete"||op.type==="reply"||op.type==="canned-reply"){
                ticket.generation++;const action=op.type==="close"?"close-everyone":op.type==="reopen"?"reopen-requester":op.type==="delete"?"delete":"reply"
                const g=grant(ticket,input,action);if(action==="reply")g.content=op.type==="reply"?op.content:{content:"Canned reply"}
                return Effect.succeed({duplicate:false,type:"ticket",ticket:cloned(ticket),grant:g})
            }
            return Effect.succeed({duplicate:false,type:"ticket",ticket:cloned(ticket)})
        },
        intake(input){calls.push({method:"intake",input});const op=input.operation
            if(op.type==="open"){const c=categories.get(op.categoryName)!;const i:C.TicketIntake={intakeNo:intakes.size+1,generation:1,category:{name:c.name,revision:c.revision,enabled:c.enabled,visibility:c.visibility,description:c.description,parentId:c.parentId,supportRoleIds:c.supportRoleIds,questions:c.questions},requesterId:input.context.actor.userId,joinedAt:input.context.actor.joinedAt,answers:[],state:"draft",createdAt:input.createdAt,expiresAt:Number.MAX_SAFE_INTEGER};intakes.set(i.intakeNo,i);return Effect.succeed({duplicate:false,type:"intake",intake:cloned(i)})}
            const i=intakes.get(op.intakeNo)!;i.generation++
            if(op.type==="answer")i.answers[op.question-1]=op.answer
            if(op.type==="cancel")i.state="cancelled"
            if(op.type==="submit"){i.state="submitted";const t:C.TicketRecord={ticketNo:tickets.size+1,requesterId:i.requesterId,requesterJoinedAt:i.joinedAt,categoryName:i.category.name,categoryRevision:i.category.revision,visibility:i.category.visibility,supportRoleIds:i.category.supportRoleIds,state:"creating",generation:1,botId:input.context.botId,priority:"normal",createdAt:input.createdAt,erased:false,entryCount:0};tickets.set(t.ticketNo,t);i.ticketNo=t.ticketNo;return Effect.succeed({duplicate:false,type:"ticket",ticket:cloned(t),grant:grant(t,input,"create")})}
            return Effect.succeed({duplicate:false,type:"intake",intake:cloned(i)})
        },
        dispatch(input){calls.push({method:"dispatch",input});const t=tickets.get(input.ticketNo),g=t?.currentAttempt;if(!g||claims.has(input.attemptId))return Effect.succeed({claimed:false,dispatchExpiresAt:g?.dispatchExpiresAt??0,nativeDeadlineMs:5000});claims.set(input.attemptId,input.claimToken);return Effect.succeed({claimed:true,dispatchExpiresAt:g.dispatchExpiresAt,nativeDeadlineMs:5000})},
        outcome(input){calls.push({method:"outcome",input});const t=tickets.get(input.ticketNo)!;if(input.channelId)t.channelId=input.channelId;if(input.channel)t.channel=cloned(input.channel)
            if(t.currentAttempt)t.currentAttempt.outcome=input.outcome
            if(input.outcome!=="succeeded"){t.state="uncertain";return Effect.succeed({recorded:true,ticket:cloned(t)})}
            const action=t.currentAttempt!.action,next=action==="create"?"introduction":action==="close-everyone"?"close-requester":action==="reopen-requester"?"reopen-everyone":undefined
            if(next){t.generation++;return Effect.succeed({recorded:true,ticket:cloned(t),grant:grant(t,{serverId:input.serverId,messageId:input.sourceId,createdAt:0,context:{observedAt:0,botId:t.botId,botAuthorized:true,actor:{userId:t.currentAttempt!.actorId,roleIds:[],isOwner:true,isAdministrator:true,nativePermissionAuthorized:true,joinedAt:t.requesterJoinedAt,isBot:false,timeoutUntil:null,privateChannelVerified:false,canView:true,canReadHistory:true,canSend:true}}},next)})}
            t.state=action==="delete"?"retired":action==="close-requester"?"closed":"open";if(action==="delete")t.retiredAt=1
            return Effect.succeed({recorded:true,ticket:cloned(t)})
        },
        reconcile(input){calls.push({method:"reconcile",input});return Effect.succeed({recorded:true,ticket:cloned(tickets.get(input.ticketNo)!)})},
        transcriptUpload(input) {
            calls.push({ method: "transcriptUpload", input })
            const body = input.messages.map(m => `${m.authorId}: ${m.content}`).join("\n")
            const record: C.TicketTranscript = { transcriptNo: transcripts.size + 1, ticketNo: input.ticketNo, channelId: tickets.get(input.ticketNo)!.channelId!,
                capturedAt: input.capturedAt, messageCount: input.messages.length, truncated: input.truncated, erased: false, pages: Math.max(1, Math.ceil(body.length / 1500)) }
            transcripts.set(record.transcriptNo, { record, messages: cloned(input.messages), body })
            return Effect.succeed({ duplicate: false, transcript: cloned(record) })
        },...overrides,
    }
    return {store,calls,categories,intakes,tickets,entries,transcripts,settings,grant,claims,attempts}
}
