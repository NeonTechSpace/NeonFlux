import { vcGeneratorRulesTable } from './tables/vc_generator_rules.js';
import { generatedVoiceChannelsTable } from './tables/generated_voice_channels.js';
import { vcGeneratorControlPanelsTable } from './tables/vc_generator_control_panels.js';
import { vcGeneratorControlRequestsTable } from './tables/vc_generator_control_requests.js';

export const vcGeneratorTables = {
    vcGeneratorRules: vcGeneratorRulesTable,
    generatedVoiceChannels: generatedVoiceChannelsTable,
    vcGeneratorControlPanels: vcGeneratorControlPanelsTable,
    vcGeneratorControlRequests: vcGeneratorControlRequestsTable,
};
