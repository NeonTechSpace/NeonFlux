import { fail } from "./validation.ts"
export function configurationCursor(scope:string,key:string|number) {return `nf-config-v1:${JSON.stringify([scope,key])}`}
export function configurationCursorKey(scope:string,value:unknown):string|number|undefined {
 if(value===undefined)return undefined
 if(typeof value!=="string" || value.length>1024 || !value.startsWith("nf-config-v1:"))fail(400,"Invalid configuration cursor")
 let decoded:unknown;try{decoded=JSON.parse(value.slice(13))}catch{fail(400,"Invalid configuration cursor")}
 if(!Array.isArray(decoded) || decoded.length!==2 || decoded[0]!==scope || !(typeof decoded[1]==="string" || typeof decoded[1]==="number" && Number.isSafeInteger(decoded[1])))fail(400,"Foreign configuration cursor")
 return decoded[1]
}
