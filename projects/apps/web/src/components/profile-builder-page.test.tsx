// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { submitPublicProfileBuilderFormRouteData } from '../server/profile-builder-route-data.js';
import type * as ProfileBuilderRouteDataModule from '../server/profile-builder-route-data.js';
import { ProfileBuilderPage } from './profile-builder-page.js';

vi.mock('../server/profile-builder-route-data.js', async (importActual) => {
    const actual = await importActual<typeof ProfileBuilderRouteDataModule>();

    return {
        ...actual,
        submitPublicProfileBuilderFormRouteData: vi.fn(),
    };
});

describe('ProfileBuilderPage', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('submits profile form values through the public route data function', async () => {
        vi.mocked(submitPublicProfileBuilderFormRouteData).mockResolvedValue({
            type: 'submitted',
            submissionId: 'submission-1',
            status: 'pending',
        });

        render(
            <ProfileBuilderPage
                data={{
                    type: 'form',
                    guildId: 'guild-1',
                    formId: 'form-1',
                    formName: 'default',
                    approvalRequired: true,
                    fields: [
                        {
                            fieldKey: 'display_name',
                            label: 'Display name',
                            fieldType: 'text',
                            required: true,
                            maxLength: 80,
                            position: 0,
                        },
                        {
                            fieldKey: 'bio',
                            label: 'Bio',
                            fieldType: 'textarea',
                            required: false,
                            maxLength: 500,
                            position: 1,
                        },
                    ],
                }}
            />
        );

        fireEvent.change(screen.getByLabelText(/Display name/u), { target: { value: 'Neon' } });
        fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Flux enthusiast' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit profile' }));

        await waitFor(() => expect(submitPublicProfileBuilderFormRouteData).toHaveBeenCalled());
        expect(submitPublicProfileBuilderFormRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                formName: 'default',
                values: {
                    display_name: 'Neon',
                    bio: 'Flux enthusiast',
                },
            },
        });
        expect(await screen.findByText('Submitted for review.')).toBeTruthy();
    });

    it('renders unavailable form state', () => {
        render(<ProfileBuilderPage data={{ type: 'not-found' }} />);

        expect(screen.getByRole('heading', { name: 'Form unavailable' })).toBeTruthy();
    });
});
