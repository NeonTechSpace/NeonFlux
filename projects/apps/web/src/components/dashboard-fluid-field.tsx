import { useEffect, useRef } from 'react';

const MAX_RENDER_PIXELS = 320_000;
const FRAME_INTERVAL_MS = 1000 / 30;
const INITIAL_TIME_RANGE_SECONDS = 60;

const vertexShaderSource = `
attribute vec2 a_position;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;

void addBall(
    vec2 point,
    vec2 center,
    float radius,
    vec3 color,
    inout float field,
    inout vec3 weightedColor
) {
    vec2 distanceFromCenter = point - center;
    float influence = pow(
        radius * radius / (dot(distanceFromCenter, distanceFromCenter) + 0.006),
        1.45
    );
    field += influence;
    weightedColor += color * influence;
}

void main() {
    vec2 point = gl_FragCoord.xy / u_resolution * 2.0 - 1.0;
    point.x *= u_resolution.x / u_resolution.y;

    float time = u_time * 0.38;
    float field = 0.0;
    vec3 weightedColor = vec3(0.0);

    addBall(point, vec2(-1.30 + sin(time * 0.71) * 0.32,  0.57 + cos(time * 0.53) * 0.23), 0.48, vec3(0.02, 0.30, 0.38), field, weightedColor);
    addBall(point, vec2(-0.83 + cos(time * 0.59) * 0.35,  0.15 + sin(time * 0.47) * 0.31), 0.43, vec3(0.03, 0.23, 0.43), field, weightedColor);
    addBall(point, vec2(-0.31 + sin(time * 0.43) * 0.34,  0.48 + cos(time * 0.67) * 0.25), 0.36, vec3(0.10, 0.20, 0.48), field, weightedColor);
    addBall(point, vec2( 0.12 + cos(time * 0.41) * 0.39, -0.05 + sin(time * 0.61) * 0.29), 0.46, vec3(0.18, 0.16, 0.47), field, weightedColor);
    addBall(point, vec2( 0.66 + sin(time * 0.53) * 0.36,  0.44 + cos(time * 0.37) * 0.25), 0.40, vec3(0.27, 0.13, 0.44), field, weightedColor);
    addBall(point, vec2( 1.22 + cos(time * 0.49) * 0.31,  0.10 + sin(time * 0.57) * 0.34), 0.47, vec3(0.34, 0.12, 0.39), field, weightedColor);
    addBall(point, vec2(-0.70 + sin(time * 0.31) * 0.29, -0.61 + cos(time * 0.43) * 0.22), 0.42, vec3(0.03, 0.27, 0.38), field, weightedColor);
    addBall(point, vec2( 0.05 + cos(time * 0.35) * 0.41, -0.63 + sin(time * 0.39) * 0.21), 0.45, vec3(0.12, 0.18, 0.46), field, weightedColor);
    addBall(point, vec2( 0.91 + sin(time * 0.39) * 0.34, -0.57 + cos(time * 0.45) * 0.24), 0.44, vec3(0.31, 0.12, 0.41), field, weightedColor);

    vec3 gelColor = weightedColor / max(field, 0.001);
    float gel = smoothstep(2.00, 2.34, field);
    float innerSurface = smoothstep(2.28, 5.2, field);
    float rim = smoothstep(1.86, 2.08, field) - smoothstep(2.08, 2.62, field);
    gelColor *= 0.88 + innerSurface * 0.18;
    gelColor += rim * vec3(0.025, 0.04, 0.06);

    float opacity = clamp(gel * 0.32 + rim * 0.08, 0.0, 0.4);
    gl_FragColor = vec4(gelColor, opacity);
}
`;

interface FluidRenderer {
    draw: (time: number) => void;
    resize: () => void;
    dispose: () => void;
}

export function DashboardFluidField({ motionEnabled }: { motionEnabled: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const elapsedSecondsRef = useRef(0);
    const initialTimeRef = useRef<number | null>(null);
    const rendererRef = useRef<FluidRenderer | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        initialTimeRef.current ??= Math.random() * INITIAL_TIME_RANGE_SECONDS;
        elapsedSecondsRef.current = initialTimeRef.current;

        const renderer = createFluidRenderer(canvas, () => elapsedSecondsRef.current);

        if (!renderer) {
            return;
        }

        rendererRef.current = renderer;
        renderer.resize();

        const resizeObserver = new ResizeObserver(renderer.resize);
        resizeObserver.observe(canvas);

        return () => {
            resizeObserver.disconnect();
            renderer.dispose();
            rendererRef.current = null;
        };
    }, []);

    useEffect(() => {
        const renderer = rendererRef.current;

        if (!renderer) {
            return;
        }

        if (!motionEnabled) {
            renderer.draw(elapsedSecondsRef.current);
            return;
        }

        let animationFrame = 0;
        let previousFrameTime = performance.now();

        const animate = (frameTime: number) => {
            const elapsedMilliseconds = frameTime - previousFrameTime;

            if (elapsedMilliseconds >= FRAME_INTERVAL_MS) {
                elapsedSecondsRef.current += Math.min(elapsedMilliseconds / 1000, 0.1);
                previousFrameTime = frameTime;
                renderer.draw(elapsedSecondsRef.current);
            }

            animationFrame = requestAnimationFrame(animate);
        };

        animationFrame = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(animationFrame);
    }, [motionEnabled]);

    return <canvas ref={canvasRef} className='absolute inset-0 z-10 size-full' />;
}

function createFluidRenderer(canvas: HTMLCanvasElement, getTime: () => number): FluidRenderer | null {
    if (typeof WebGLRenderingContext === 'undefined') {
        return null;
    }

    const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        powerPreference: 'low-power',
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        stencil: false,
    });

    if (!gl) {
        return null;
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) {
        if (vertexShader) {
            gl.deleteShader(vertexShader);
        }

        if (fragmentShader) {
            gl.deleteShader(fragmentShader);
        }

        return null;
    }

    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return null;
    }

    const positionBuffer = gl.createBuffer();
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');

    if (positionLocation < 0 || resolutionLocation === null || timeLocation === null) {
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return null;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const draw = (time: number) => {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform1f(timeLocation, time);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const resize = () => {
        const bounds = canvas.getBoundingClientRect();

        if (bounds.width <= 0 || bounds.height <= 0) {
            return;
        }

        const devicePixelRatio = Math.min(window.devicePixelRatio, 1);
        const requestedWidth = bounds.width * devicePixelRatio;
        const requestedHeight = bounds.height * devicePixelRatio;
        const renderScale = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / (requestedWidth * requestedHeight)));
        const width = Math.max(1, Math.round(requestedWidth * renderScale));
        const height = Math.max(1, Math.round(requestedHeight * renderScale));

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        draw(getTime());
    };

    return {
        dispose: () => {
            gl.deleteBuffer(positionBuffer);
            gl.deleteProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
        },
        draw,
        resize,
    };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);

    if (!shader) {
        return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}
