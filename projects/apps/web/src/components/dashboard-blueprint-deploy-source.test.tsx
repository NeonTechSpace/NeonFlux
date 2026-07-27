/** @vitest-environment jsdom */
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BLUEPRINT_SNAPSHOT_LIMITS } from '@neonflux/blueprint/snapshot';
import { DashboardBlueprintDeploySource } from './dashboard-blueprint-deploy-source.js';
import { readDashboardBlueprintSourceFiles } from './dashboard-blueprint-deploy-source-state.js';

const validJson = '{"version":1,"roles":[],"categories":[],"channels":[]}';

afterEach(cleanup);

describe('readDashboardBlueprintSourceFiles', () => {
    it('accepts one canonical Blueprint file', async () => {
        const file = createFile({ text: validJson });

        await expect(readDashboardBlueprintSourceFiles([file])).resolves.toEqual({
            status: 'ready',
            mode: 'file',
            json: validJson,
            file: { name: 'blueprint.json', size: validJson.length },
        });
    });

    it('rejects invalid, oversized, multiple, and unreadable files without retaining source authority', async () => {
        const tooLargeRead = vi.fn<() => Promise<string>>();
        const tooLarge = createFile({
            size: BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes + 1,
            text: tooLargeRead,
        });
        await expect(readDashboardBlueprintSourceFiles([tooLarge])).resolves.toMatchObject({
            status: 'invalid',
            message: 'Choose a JSON file up to 4 MiB.',
        });
        expect(tooLargeRead).not.toHaveBeenCalled();

        await expect(readDashboardBlueprintSourceFiles([createFile({ text: '{"version":1}' })])).resolves.toMatchObject(
            {
                status: 'invalid',
                message: 'This file is not valid Blueprint JSON.',
            }
        );
        await expect(readDashboardBlueprintSourceFiles([createFile(), createFile()])).resolves.toMatchObject({
            status: 'invalid',
            message: 'Choose one JSON file at a time.',
        });
        await expect(
            readDashboardBlueprintSourceFiles([createFile({ text: () => Promise.reject(new Error('unreadable')) })])
        ).resolves.toMatchObject({
            status: 'invalid',
            message: 'This file could not be read. Choose it again or use Paste JSON.',
        });
    });
});

describe('DashboardBlueprintDeploySource file mode', () => {
    it('uses one visible picker surface for click, keyboard, and drop', () => {
        const onFilesSelected = vi.fn();
        renderSource(onFilesSelected);

        expect(screen.queryByText('Upload JSON')).toBeNull();
        expect(screen.getByText('Choose a Blueprint JSON file')).toBeTruthy();
        const input = screen.getByLabelText<HTMLInputElement>('Blueprint JSON file input');
        const dropZone = screen.getByRole('button', { name: /Choose a Blueprint JSON file/u });
        expect(screen.getAllByRole('button', { name: /Choose a Blueprint JSON file/u })).toHaveLength(1);
        const pickerClick = vi.spyOn(input, 'click');

        fireEvent.click(dropZone);
        fireEvent.keyDown(dropZone, { key: 'Enter' });
        fireEvent.keyDown(dropZone, { key: ' ' });
        expect(pickerClick).toHaveBeenCalledTimes(3);

        const file = createFile({ text: validJson });
        fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
        expect(onFilesSelected).toHaveBeenCalledWith([file]);
    });

    it('clears the native value so the same file can be selected again', () => {
        const onFilesSelected = vi.fn();
        renderSource(onFilesSelected);
        const input = screen.getByLabelText<HTMLInputElement>('Blueprint JSON file input');
        const file = createFile();
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        Object.defineProperty(input, 'value', { configurable: true, writable: true, value: 'blueprint.json' });

        fireEvent.change(input);

        expect(onFilesSelected).toHaveBeenCalledWith([file]);
        expect(input.value).toBe('');
    });
});

function renderSource(onFilesSelected: (files: readonly File[]) => void) {
    return render(
        <DashboardBlueprintDeploySource
            mode='file'
            pasteJson=''
            roleMappingConflicts={[]}
            roleMappings={{}}
            sourceState={{ status: 'empty', mode: 'file' }}
            step='source'
            structurePolicy='synchronize'
            targetGuildId='guild-1'
            targetGuildName='Guild One'
            onChangeSource={() => undefined}
            onFilesSelected={onFilesSelected}
            onInspectSource={() => undefined}
            onModeChange={() => undefined}
            onPasteJsonChange={() => undefined}
            onRoleMappingChange={() => undefined}
            onStructurePolicyChange={() => undefined}
        />
    );
}

function createFile({
    name = 'blueprint.json',
    size,
    text = validJson,
}: {
    name?: string;
    size?: number;
    text?: string | (() => Promise<string>);
} = {}): File {
    const read = typeof text === 'function' ? text : () => Promise.resolve(text);
    return {
        name,
        size: size ?? (typeof text === 'string' ? text.length : validJson.length),
        text: read,
    } as File;
}
