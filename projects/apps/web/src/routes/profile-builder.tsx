import { createFileRoute } from '@tanstack/react-router';

import { ProfileBuilderPage } from '../components/profile-builder-page.js';
import { readPublicProfileBuilderPageRouteData } from '../server/profile-builder-route-data.js';

type ProfileBuilderSearch = {
    guildId: string;
    form: string;
};

const createRoute = createFileRoute('/profile-builder');

export const Route = createRoute({
    validateSearch: (search: Record<string, unknown>): ProfileBuilderSearch => ({
        guildId: typeof search.guildId === 'string' ? search.guildId : '',
        form: typeof search.form === 'string' && search.form.trim() ? search.form : 'default',
    }),
    loaderDeps: ({ search }) => ({
        guildId: search.guildId,
        formName: search.form,
    }),
    loader: ({ deps }) =>
        readPublicProfileBuilderPageRouteData({
            data: deps,
        }),
    component: ProfileBuilderRoute,
});

function ProfileBuilderRoute() {
    const data = Route.useLoaderData();

    return <ProfileBuilderPage data={data} />;
}
