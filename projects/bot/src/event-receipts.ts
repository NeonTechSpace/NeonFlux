// Events of one server run in separate SDK queues, and a starting server holds them, so they can run in any order.
// The SDK runs a partition function once per event, when the event is received and in the order the gateway sent
// them. The router uses these as partition functions, so every event has a receipt number that tells which of two
// events arrived first
const receipts = new WeakMap<object, number>()
let received = 0
/** A receipt number for something that is not an event, such as the start of a check, ordered with the events */
export const nextReceipt = () => ++received
/** Numbers an event by its receipt and returns its partition key */
export function receiveEvent<K extends string | undefined>(event: object, key: K): K {
    receipts.set(event, nextReceipt())
    return key
}
/** The receipt number of an event, which a copy of the event keeps through carryReceipt */
export const receiptOf = (event: object) => receipts.get(event) ?? 0
export function carryReceipt(from: object, to: object) {
    const receipt = receipts.get(from)
    if (receipt !== undefined) receipts.set(to, receipt)
}
