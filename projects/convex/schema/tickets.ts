import { ticketPanelsTable } from './tables/ticket_panels.js';
import { ticketCountersTable } from './tables/ticket_counters.js';
import { ticketsTable } from './tables/tickets.js';
import { ticketMembersTable } from './tables/ticket_members.js';
import { ticketEventsTable } from './tables/ticket_events.js';

export const ticketTables = {
    ticketPanels: ticketPanelsTable,
    ticketCounters: ticketCountersTable,
    tickets: ticketsTable,
    ticketMembers: ticketMembersTable,
    ticketEvents: ticketEventsTable,
};
