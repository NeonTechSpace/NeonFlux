import { suggestionBoardsTable } from './tables/suggestion_boards.js';
import { suggestionsTable } from './tables/suggestions.js';
import { suggestionVotesTable } from './tables/suggestion_votes.js';
import { profileFormsTable } from './tables/profile_forms.js';
import { profileFieldsTable } from './tables/profile_fields.js';
import { profileSubmissionsTable } from './tables/profile_submissions.js';
import { profileSubmissionReviewsTable } from './tables/profile_submission_reviews.js';
import { giveawaysTable } from './tables/giveaways.js';
import { giveawayEntriesTable } from './tables/giveaway_entries.js';
import { giveawayWinnersTable } from './tables/giveaway_winners.js';
import { giveawayEventsTable } from './tables/giveaway_events.js';

export const communityTables = {
    suggestionBoards: suggestionBoardsTable,
    suggestions: suggestionsTable,
    suggestionVotes: suggestionVotesTable,
    profileForms: profileFormsTable,
    profileFields: profileFieldsTable,
    profileSubmissions: profileSubmissionsTable,
    profileSubmissionReviews: profileSubmissionReviewsTable,
    giveaways: giveawaysTable,
    giveawayEntries: giveawayEntriesTable,
    giveawayWinners: giveawayWinnersTable,
    giveawayEvents: giveawayEventsTable,
};
