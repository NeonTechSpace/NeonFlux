import { v } from "convex/values"
import { SuggestionsCardState, SuggestionsState, SuggestionsVoteChoice } from "@neonflux/contracts/suggestions"

// Stored enums follow the shared literals
export const suggestionState = v.union(...SuggestionsState.literals.map(state => v.literal(state)))
export const suggestionChoice = v.union(...SuggestionsVoteChoice.literals.map(choice => v.literal(choice)))
export const suggestionCardState = v.union(...SuggestionsCardState.literals.map(state => v.literal(state)))
export const suggestionBindingFields = { suggestionNo: v.number(), cardGeneration: v.number(), desiredRevision: v.number() }
export const publishingSuggestionConsumer = v.object({ type: v.literal("suggestion-card"), ...suggestionBindingFields })
