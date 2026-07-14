// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardFluidField } from './dashboard-fluid-field.js';

const drawnTimes: number[] = [];

describe('DashboardFluidField', () => {
    beforeEach(() => {
        drawnTimes.length = 0;
        vi.stubGlobal('WebGLRenderingContext', class WebGLRenderingContext {});
        vi.stubGlobal(
            'ResizeObserver',
            class ResizeObserver {
                disconnect() {}
                observe() {}
                unobserve() {}
            }
        );
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createWebGlContext());
        vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
            bottom: 100,
            height: 100,
            left: 0,
            right: 100,
            top: 0,
            width: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('chooses a new initial composition on each mount without reseeding rerenders', () => {
        const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.8);
        const view = render(<DashboardFluidField motionEnabled={false} />);
        const firstTime = drawnTimes.at(-1);

        view.rerender(<DashboardFluidField motionEnabled={false} />);

        expect(random).toHaveBeenCalledTimes(1);
        expect(drawnTimes.at(-1)).toBe(firstTime);

        view.unmount();
        render(<DashboardFluidField motionEnabled={false} />);

        expect(random).toHaveBeenCalledTimes(2);
        expect(drawnTimes.at(-1)).not.toBe(firstTime);
    });
});

function createWebGlContext(): WebGLRenderingContext {
    const timeLocation = {} as WebGLUniformLocation;
    const resolutionLocation = {} as WebGLUniformLocation;

    return {
        ARRAY_BUFFER: 0x8892,
        COMPILE_STATUS: 0x8b81,
        FLOAT: 0x1406,
        FRAGMENT_SHADER: 0x8b30,
        LINK_STATUS: 0x8b82,
        STATIC_DRAW: 0x88e4,
        TRIANGLES: 0x0004,
        VERTEX_SHADER: 0x8b31,
        attachShader: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        compileShader: vi.fn(),
        createBuffer: vi.fn(() => ({})),
        createProgram: vi.fn(() => ({})),
        createShader: vi.fn(() => ({})),
        deleteBuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        drawArrays: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        getAttribLocation: vi.fn(() => 0),
        getProgramParameter: vi.fn(() => true),
        getShaderParameter: vi.fn(() => true),
        getUniformLocation: vi.fn((_program, name) => (name === 'u_time' ? timeLocation : resolutionLocation)),
        linkProgram: vi.fn(),
        shaderSource: vi.fn(),
        uniform1f: vi.fn((location, value) => {
            if (location === timeLocation) drawnTimes.push(value);
        }),
        uniform2f: vi.fn(),
        useProgram: vi.fn(),
        vertexAttribPointer: vi.fn(),
        viewport: vi.fn(),
    } as unknown as WebGLRenderingContext;
}
