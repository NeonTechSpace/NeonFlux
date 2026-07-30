import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

import { admitServerFunctionRequest } from '../server-request-body-limit.js';

export default createServerEntry({
    async fetch(request, options) {
        const admitted = await admitServerFunctionRequest(request);
        return admitted instanceof Response ? admitted : handler.fetch(admitted, options);
    },
});
